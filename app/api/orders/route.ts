import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

interface OrderLinePayload {
  lineId: string;
  productId: string;
  fudoProductId?: string;
  quantity: number;
  unitPrice: number;
  comment?: string;
}

interface CreateOrderPayload {
  idempotencyKey: string;
  mesaNumero: string;
  catalogRevision?: string;
  lines: OrderLinePayload[];
}

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: Request) {
  let body: CreateOrderPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { idempotencyKey, mesaNumero, catalogRevision, lines } = body;

  if (!idempotencyKey || !mesaNumero || !Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const sb = supabase();

  // Idempotencia: si ya existe este key devolver el mismo resultado
  const { data: existing } = await sb
    .from("orders")
    .select("id, status, table_session_id")
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
    // Crear nueva sesión — fudo_table_id se resuelve luego en el worker con GET /tables
    const { data: newSession, error: sessionErr } = await sb
      .from("table_sessions")
      .insert({
        mesa_numero: mesaNumero,
        fudo_table_id: "pending", // el worker lo resuelve
        session_state: "READY",
      })
      .select("id")
      .single();

    if (sessionErr || !newSession) {
      console.error("Error creando sesión:", sessionErr);
      return NextResponse.json({ error: "Error creando sesión" }, { status: 500 });
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
    console.error("Error creando order:", orderErr);
    return NextResponse.json({ error: "Error guardando pedido" }, { status: 500 });
  }

  // Insertar líneas
  const lineRows = lines.map((l) => ({
    order_id: order.id,
    line_id: l.lineId,
    product_id: l.productId,
    fudo_product_id: l.fudoProductId ?? null,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    comment: l.comment ?? null,
    status: "PENDING",
  }));

  const { error: linesErr } = await sb.from("order_lines").insert(lineRows);

  if (linesErr) {
    console.error("Error creando líneas:", linesErr);
    return NextResponse.json({ error: "Error guardando líneas" }, { status: 500 });
  }

  // Insertar en outbox para que el worker lo procese
  const { error: outboxErr } = await sb.from("order_outbox").insert({
    order_id: order.id,
    status: "PENDING",
  });

  if (outboxErr) {
    console.error("Error creando outbox:", outboxErr);
    // No es fatal — el pedido quedó guardado, el worker puede reintentar
  }

  return NextResponse.json({ orderId: order.id, status: "RECEIVED" }, { status: 202 });
}
