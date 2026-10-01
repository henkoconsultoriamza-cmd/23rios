// Edge Function: process-fudo-order
// Se ejecuta cada vez que se inserta una fila en order_outbox.
// Toma el pedido, abre la Sale en Fudo si no existe, y envía cada Item.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FUDO_BASE_URL = Deno.env.get("FUDO_BASE_URL") ?? "https://api.fu.do/v1alpha1";
const FUDO_AUTH_URL = Deno.env.get("FUDO_AUTH_URL") ?? "https://auth.fu.do/api";
const FUDO_API_KEY = Deno.env.get("FUDO_API_KEY")!;
const FUDO_API_SECRET = Deno.env.get("FUDO_API_SECRET")!;

// ─── Token cache ──────────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getFudoToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedToken && nowSec < tokenExpiresAt - 60) return cachedToken;

  const res = await fetch(FUDO_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: FUDO_API_KEY, apiSecret: FUDO_API_SECRET }),
  });
  if (!res.ok) throw new Error(`Fudo auth failed: ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.token;
  tokenExpiresAt = data.exp;
  return cachedToken!;
}

async function fudoRequest(path: string, options: RequestInit = {}) {
  const token = await getFudoToken();
  const res = await fetch(`${FUDO_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Fudo ${options.method ?? "GET"} ${path} → ${res.status}: ${body}`);
  return JSON.parse(body);
}

// ─── Resolver mesa número → Fudo table ID ────────────────────────────────────

async function resolveFudoTableId(mesaNumero: string): Promise<string> {
  const data = await fudoRequest("/tables?page[size]=500");
  const tables: Array<{ id: string; attributes: { number: number } }> = data.data ?? [];
  const match = tables.find((t) => String(t.attributes.number) === mesaNumero);
  if (!match) throw new Error(`Mesa ${mesaNumero} no encontrada en Fudo`);
  return match.id;
}

// ─── Handler principal ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Validar que la llamada viene del trigger de Supabase (service_role_key)
  const authHeader = req.headers.get("authorization");
  const expectedToken = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authHeader || !expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const payload = await req.json();
    const outboxId: string = payload.record?.id ?? payload.outbox_id;
    if (!outboxId) return new Response("missing outbox_id", { status: 400 });

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Tomar el outbox y aplicar lease (evita doble procesamiento)
    const leaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { data: outbox, error: leaseErr } = await sb
      .from("order_outbox")
      .update({ status: "PROCESSING", leased_until: leaseUntil })
      .eq("id", outboxId)
      .eq("status", "PENDING")
      .select("id, order_id, attempts")
      .single();

    if (leaseErr || !outbox) {
      // Ya lo está procesando otro worker
      return new Response("already processing", { status: 200 });
    }

    try {
      await processOrder(sb, outbox.order_id);

      await sb.from("order_outbox")
        .update({ status: "DONE" })
        .eq("id", outboxId);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("process-fudo-order error:", msg);

      await sb.from("order_outbox")
        .update({
          status: outbox.attempts >= 2 ? "FAILED" : "PENDING",
          leased_until: null,
          attempts: outbox.attempts + 1,
        })
        .eq("id", outboxId);

      await sb.from("orders")
        .update({ status: "REQUIRES_REVIEW" })
        .eq("id", outbox.order_id);
    }

    return new Response("ok", { status: 200 });

  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response("internal error", { status: 500 });
  }
});

// ─── Lógica de procesamiento ──────────────────────────────────────────────────

async function processOrder(
  sb: ReturnType<typeof createClient>,
  orderId: string
) {
  // Cargar orden + sesión + líneas
  const { data: order } = await sb
    .from("orders")
    .select("id, table_session_id, status")
    .eq("id", orderId)
    .single();

  if (!order) throw new Error(`Order ${orderId} not found`);

  await sb.from("orders").update({ status: "PROCESSING" }).eq("id", orderId);

  const { data: session } = await sb
    .from("table_sessions")
    .select("id, mesa_numero, fudo_table_id, fudo_sale_id, session_state")
    .eq("id", order.table_session_id)
    .single();

  if (!session) throw new Error(`Session not found for order ${orderId}`);

  const { data: lines } = await sb
    .from("order_lines")
    .select("id, line_id, fudo_product_id, quantity, unit_price, comment, status, parent_line_id")
    .eq("order_id", orderId)
    .eq("status", "PENDING");

  if (!lines || lines.length === 0) {
    await sb.from("orders").update({ status: "REGISTERED" }).eq("id", orderId);
    return;
  }

  // Resolver Fudo table ID si todavía está pendiente
  let fudoTableId = session.fudo_table_id;
  if (fudoTableId === "pending") {
    fudoTableId = await resolveFudoTableId(session.mesa_numero);
    await sb.from("table_sessions")
      .update({ fudo_table_id: fudoTableId })
      .eq("id", session.id);
  }

  // Abrir Sale en Fudo si la sesión está en READY
  let fudoSaleId = session.fudo_sale_id;
  if (!fudoSaleId) {
    await sb.from("table_sessions")
      .update({ session_state: "OPENING" })
      .eq("id", session.id);

    const saleRes = await fudoRequest("/sales", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "Sale",
          attributes: { saleType: "EAT-IN", people: session.people ?? 1 },
          relationships: {
            table: { data: { type: "Table", id: fudoTableId } },
          },
        },
      }),
    });

    fudoSaleId = saleRes.data.id;
    await sb.from("table_sessions")
      .update({ fudo_sale_id: fudoSaleId, session_state: "OPEN" })
      .eq("id", session.id);
  }

  // Verificar que la Sale siga abierta
  const saleDoc = await fudoRequest(`/sales/${fudoSaleId}`);
  const saleState = saleDoc.data?.attributes?.saleState;
  if (saleState !== "IN-COURSE") {
    await sb.from("table_sessions")
      .update({ session_state: "CLOSED", closed_at: new Date().toISOString() })
      .eq("id", session.id);
    throw new Error(`Sale ${fudoSaleId} no está IN-COURSE (estado: ${saleState})`);
  }

  // Separar líneas padre de modificadores
  const parentLines = lines.filter((l: { parent_line_id: string | null }) => !l.parent_line_id);
  const modifierLines = lines.filter((l: { parent_line_id: string | null }) => !!l.parent_line_id);

  // Mapa line_id → fudo_item_id para vincular modificadores
  const lineIdToFudoItemId = new Map<string, string>();

  // ── Paso 1: enviar líneas padre ──────────────────────────────────────────
  for (const line of parentLines) {
    if (!line.fudo_product_id) {
      await sb.from("order_lines")
        .update({ status: "REJECTED", error_detail: "Sin fudoProductId" })
        .eq("id", line.id);
      continue;
    }

    await sb.from("order_lines")
      .update({ status: "SENDING", attempts: (line.attempts ?? 0) + 1 })
      .eq("id", line.id);

    const itemBody = {
      data: {
        type: "Item",
        attributes: {
          quantity: line.quantity,
          price: line.unit_price,
          ...(line.comment ? { comment: line.comment } : {}),
        },
        relationships: {
          product: { data: { type: "Product", id: line.fudo_product_id } },
          sale: { data: { type: "Sale", id: fudoSaleId } },
        },
      },
    };

    const itemRes = await fudoRequest("/items", {
      method: "POST",
      body: JSON.stringify(itemBody),
    });

    const fudoItemId = itemRes.data?.id;
    lineIdToFudoItemId.set(line.line_id, fudoItemId);

    await sb.from("order_lines")
      .update({ status: "ACKNOWLEDGED", fudo_item_id: fudoItemId })
      .eq("id", line.id);

    const itemDoc = await fudoRequest(`/items/${fudoItemId}`);
    const itemOk = itemDoc.data?.id === fudoItemId;
    await sb.from("order_lines")
      .update({ status: itemOk ? "VERIFIED" : "UNKNOWN" })
      .eq("id", line.id);
  }

  // ── Paso 2: enviar modificadores referenciando al padre ──────────────────
  for (const line of modifierLines) {
    if (!line.fudo_product_id) {
      await sb.from("order_lines")
        .update({ status: "REJECTED", error_detail: "Sin fudoProductId" })
        .eq("id", line.id);
      continue;
    }

    const parentFudoItemId = lineIdToFudoItemId.get(line.parent_line_id);
    if (!parentFudoItemId) {
      // Padre fue REJECTED o no procesado — rechazar también el modificador
      await sb.from("order_lines")
        .update({ status: "REJECTED", error_detail: "Padre no enviado" })
        .eq("id", line.id);
      continue;
    }

    await sb.from("order_lines")
      .update({ status: "SENDING", attempts: (line.attempts ?? 0) + 1 })
      .eq("id", line.id);

    const modBody = {
      data: {
        type: "Item",
        attributes: { quantity: 1, price: 0 },
        relationships: {
          product: { data: { type: "Product", id: line.fudo_product_id } },
          sale: { data: { type: "Sale", id: fudoSaleId } },
          parentItem: { data: { type: "Item", id: parentFudoItemId } },
        },
      },
    };

    const modRes = await fudoRequest("/items", {
      method: "POST",
      body: JSON.stringify(modBody),
    });

    const modFudoItemId = modRes.data?.id;
    await sb.from("order_lines")
      .update({ status: "ACKNOWLEDGED", fudo_item_id: modFudoItemId })
      .eq("id", line.id);

    const modDoc = await fudoRequest(`/items/${modFudoItemId}`);
    const modOk = modDoc.data?.id === modFudoItemId;
    await sb.from("order_lines")
      .update({ status: modOk ? "VERIFIED" : "UNKNOWN" })
      .eq("id", line.id);
  }

  // Si alguna línea quedó UNKNOWN, volver a encolar para reintento
  const { data: unknownLines } = await sb
    .from("order_lines")
    .select("id")
    .eq("order_id", orderId)
    .eq("status", "UNKNOWN");

  if (unknownLines && unknownLines.length > 0) {
    // Resetear las líneas UNKNOWN a PENDING para el próximo intento
    await sb.from("order_lines")
      .update({ status: "PENDING" })
      .eq("order_id", orderId)
      .eq("status", "UNKNOWN");

    // Reinsertar en outbox solo si no superó los 3 intentos
    const { data: outboxRow } = await sb
      .from("order_outbox")
      .select("attempts")
      .eq("order_id", orderId)
      .single();

    if (outboxRow && outboxRow.attempts < 3) {
      await sb.from("order_outbox").insert({
        order_id: orderId,
        status: "PENDING",
        attempts: outboxRow.attempts,
      });
    } else {
      await sb.from("orders").update({ status: "REQUIRES_REVIEW" }).eq("id", orderId);
    }
    return;
  }

  await sb.from("orders").update({ status: "REGISTERED" }).eq("id", orderId);
}
