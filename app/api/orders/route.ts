import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// ─── Rate limiting simple en memoria ─────────────────────────────────────────
// Para producción con múltiples instancias usar Upstash Redis.
// Para un restaurante con tráfico moderado esto es suficiente.
const ipRequestMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;       // requests por ventana
const RATE_WINDOW_MS = 60_000; // 1 minuto

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequestMap.get(ip);
  if (!entry || now > entry.resetAt) {
    ipRequestMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ─── Validación de inputs ─────────────────────────────────────────────────────

function isValidUUID(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function isValidMesa(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,3}$/.test(value);
}

function sanitizeComment(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Eliminar caracteres potencialmente peligrosos
  const clean = value.replace(/[<>"'&;]/g, "").trim().slice(0, 500);
  return clean || undefined;
}

interface ModifierPayload {
  name: string;
  fudoProductId: string;
}

interface OrderLinePayload {
  lineId: string;
  productId: string;
  fudoProductId?: string;
  quantity: number;
  unitPrice: number;
  comment?: string;
  modifiers?: ModifierPayload[]; // opciones elegidas de grupos modificadores
}

interface CreateOrderPayload {
  idempotencyKey: string;
  mesaNumero: string;
  people?: number;
  catalogRevision?: string;
  lines: OrderLinePayload[];
}

function validatePayload(body: unknown): { valid: true; data: CreateOrderPayload } | { valid: false; error: string } {
  if (!body || typeof body !== "object") return { valid: false, error: "Body inválido" };
  const b = body as Record<string, unknown>;

  if (!isValidUUID(b.idempotencyKey)) return { valid: false, error: "idempotencyKey inválido" };
  if (!isValidMesa(b.mesaNumero)) return { valid: false, error: "mesaNumero inválido" };
  if (!Array.isArray(b.lines) || b.lines.length === 0) return { valid: false, error: "lines vacío" };
  if (b.lines.length > 50) return { valid: false, error: "Demasiadas líneas" };

  const people = b.people;
  if (people !== undefined && (typeof people !== "number" || people < 1 || people > 100)) {
    return { valid: false, error: "people inválido" };
  }

  for (const line of b.lines as unknown[]) {
    if (!line || typeof line !== "object") return { valid: false, error: "Línea inválida" };
    const l = line as Record<string, unknown>;
    if (typeof l.lineId !== "string" || !l.lineId) return { valid: false, error: "lineId inválido" };
    if (typeof l.productId !== "string" || !l.productId) return { valid: false, error: "productId inválido" };
    if (typeof l.quantity !== "number" || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 99) {
      return { valid: false, error: "quantity inválido" };
    }
    if (typeof l.unitPrice !== "number" || l.unitPrice < 0 || l.unitPrice > 10_000_000) {
      return { valid: false, error: "unitPrice inválido" };
    }
  }

  return {
    valid: true,
    data: {
      idempotencyKey: b.idempotencyKey as string,
      mesaNumero: b.mesaNumero as string,
      people: typeof people === "number" ? people : undefined,
      catalogRevision: typeof b.catalogRevision === "string" ? b.catalogRevision : undefined,
      lines: (b.lines as Record<string, unknown>[]).map((l) => ({
        lineId: l.lineId as string,
        productId: l.productId as string,
        fudoProductId: typeof l.fudoProductId === "string" ? l.fudoProductId : undefined,
        quantity: l.quantity as number,
        unitPrice: l.unitPrice as number,
        comment: sanitizeComment(l.comment),
        modifiers: Array.isArray(l.modifiers)
          ? (l.modifiers as Record<string, unknown>[])
              .filter((m) => typeof m.name === "string" && typeof m.fudoProductId === "string")
              .slice(0, 10)
              .map((m) => ({ name: String(m.name).slice(0, 100), fudoProductId: String(m.fudoProductId).replace(/\D/g, "").slice(0, 20) }))
          : undefined,
      })),
    },
  };
}

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: Request) {
  // Rate limiting por IP
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Demasiadas solicitudes" }, { status: 429 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const validation = validatePayload(rawBody);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { idempotencyKey, mesaNumero, people, catalogRevision, lines } = validation.data;
  const sb = supabase();

  // ── Validar modificadores de combos contra la definición guardada ─────────
  const comboLines = lines.filter((l) => l.modifiers && l.modifiers.length > 0);
  if (comboLines.length > 0) {
    const { data: promosRow } = await sb
      .from("restaurant_config")
      .select("value")
      .eq("key", "promos")
      .single();

    const promos: Array<{ id: string; comboItems?: Array<{ quantity: number }> }> =
      Array.isArray(promosRow?.value) ? promosRow.value : [];

    for (const line of comboLines) {
      const promo = promos.find((p) => p.id === line.productId);
      if (!promo) continue; // promo no encontrada — no bloqueamos, seguimos

      const maxModifiers = (promo.comboItems ?? []).reduce((sum, ci) => sum + ci.quantity, 0);
      if ((line.modifiers?.length ?? 0) > maxModifiers) {
        return NextResponse.json(
          { error: `El combo "${line.productId}" permite máximo ${maxModifiers} opciones` },
          { status: 400 }
        );
      }
    }
  }

  // Idempotencia
  const { data: existing } = await sb
    .from("orders")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .single();

  if (existing) {
    return NextResponse.json({ orderId: existing.id, status: existing.status }, { status: 200 });
  }

  // Buscar sesión activa para esta mesa
  const { data: activeSession } = await sb
    .from("table_sessions")
    .select("id, fudo_table_id")
    .eq("mesa_numero", mesaNumero)
    .not("session_state", "in", '("CLOSED")')
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let sessionId: string;

  if (activeSession) {
    sessionId = activeSession.id;
  } else {
    const { data: newSession, error: sessionErr } = await sb
      .from("table_sessions")
      .insert({
        mesa_numero: mesaNumero,
        fudo_table_id: "pending",
        session_state: "READY",
        people: people ?? 1,
      })
      .select("id")
      .single();

    if (sessionErr || !newSession) {
      console.error("Error creando sesión");
      return NextResponse.json({ error: "Error guardando pedido" }, { status: 500 });
    }
    sessionId = newSession.id;
  }

  // Insertar order
  const { data: order, error: orderErr } = await sb
    .from("orders")
    .insert({
      table_session_id: sessionId,
      idempotency_key: idempotencyKey,
      catalog_revision: catalogRevision ?? null,
      status: "RECEIVED",
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    console.error("Error creando order");
    return NextResponse.json({ error: "Error guardando pedido" }, { status: 500 });
  }

  // Insertar líneas — cada modificador se expande como línea hija con parent_line_id
  const lineRows: Record<string, unknown>[] = [];
  for (const l of lines) {
    lineRows.push({
      order_id: order.id,
      line_id: l.lineId,
      product_id: l.productId,
      fudo_product_id: l.fudoProductId ?? null,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      comment: l.comment ?? null,
      status: "PENDING",
      parent_line_id: null,
    });
    for (const mod of l.modifiers ?? []) {
      lineRows.push({
        order_id: order.id,
        line_id: `${l.lineId}:mod:${mod.fudoProductId}`,
        product_id: l.productId,
        fudo_product_id: mod.fudoProductId,
        quantity: 1,
        unit_price: 0,
        comment: mod.name,
        status: "PENDING",
        parent_line_id: l.lineId,
      });
    }
  }

  const { error: linesErr } = await sb.from("order_lines").insert(lineRows);
  if (linesErr) {
    console.error("Error creando líneas");
    return NextResponse.json({ error: "Error guardando pedido" }, { status: 500 });
  }

  // Insertar en outbox
  await sb.from("order_outbox").insert({ order_id: order.id, status: "PENDING" });

  return NextResponse.json({ orderId: order.id, status: "RECEIVED" }, { status: 202 });
}
