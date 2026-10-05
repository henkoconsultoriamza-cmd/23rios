/**
 * Fudo Worker — procesa la cola order_outbox y envía pedidos a Fudo POS
 *
 * POST /api/fudo-worker
 *   Header: x-worker-secret: <WORKER_SECRET de .env.local>
 *   → Toma hasta 5 pedidos PENDING del outbox y los envía a Fudo
 *
 * GET /api/fudo-worker
 *   → Devuelve el estado actual del outbox (para monitoreo desde admin)
 *
 * Llamar desde el panel admin o configurar un cron (ej: Vercel Cron / Cloudflare Cron).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createSale, addSaleItem, FudoError } from "@/app/lib/fudo/client";

// ── Supabase ───────────────────────────────────────────────────────────────────
function sb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ── Auth del worker ────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return true; // sin secreto configurado → acceso libre (solo dev)
  return req.headers.get("x-worker-secret") === secret;
}

// ── GET — estado del outbox ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = sb();
  const { data: counts } = await client
    .from("order_outbox")
    .select("status");

  const summary: Record<string, number> = {};
  for (const row of counts ?? []) {
    summary[row.status] = (summary[row.status] ?? 0) + 1;
  }

  return NextResponse.json({ outbox: summary });
}

// ── POST — procesar outbox ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = sb();
  const LEASE_MS = 60_000; // 60 s de lease por ítem
  const BATCH = 5;

  // 1. Tomar items disponibles (PENDING o lease expirado)
  const now = new Date().toISOString();
  const { data: items, error: fetchErr } = await client
    .from("order_outbox")
    .select("id, order_id")
    .eq("status", "PENDING")
    .or(`leased_until.is.null,leased_until.lt.${now}`)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!items || items.length === 0) {
    return NextResponse.json({ processed: 0, errors: 0, message: "Sin pedidos pendientes" });
  }

  // 2. Lease
  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  await client
    .from("order_outbox")
    .update({ status: "PROCESSING", leased_until: leaseUntil })
    .in("id", items.map((i) => i.id));

  // 3. Procesar cada pedido
  const results: { orderId: string; ok: boolean; error?: string }[] = [];

  for (const item of items) {
    try {
      await processOrder(client, item.order_id);
      await client
        .from("order_outbox")
        .update({ status: "DONE", leased_until: null })
        .eq("id", item.id);
      results.push({ orderId: item.order_id, ok: true });
    } catch (err) {
      const msg = err instanceof FudoError
        ? `${err.message} | body: ${err.body}`
        : String(err);
      console.error(`[fudo-worker] Error procesando ${item.order_id}:`, msg);
      await client
        .from("order_outbox")
        .update({ status: "ERROR", leased_until: null, error_message: msg })
        .eq("id", item.id);
      results.push({ orderId: item.order_id, ok: false, error: msg });
    }
  }

  const processed = results.filter((r) => r.ok).length;
  const errors = results.filter((r) => !r.ok).length;
  return NextResponse.json({ processed, errors, results });
}

// ── Lógica principal por pedido ────────────────────────────────────────────────
async function processOrder(client: SupabaseClient, orderId: string): Promise<void> {
  // 1. Obtener el pedido
  const { data: order, error: orderErr } = await client
    .from("orders")
    .select("id, table_session_id, status")
    .eq("id", orderId)
    .single();
  if (orderErr || !order) throw new Error(`Pedido ${orderId} no encontrado`);
  if (order.status === "REGISTERED") return; // ya procesado — idempotente

  // 2. Obtener la sesión de mesa
  const { data: session, error: sessErr } = await client
    .from("table_sessions")
    .select("id, mesa_numero, fudo_table_id, fudo_sale_id, people, session_state")
    .eq("id", order.table_session_id)
    .single();
  if (sessErr || !session) throw new Error(`Sesión no encontrada para pedido ${orderId}`);

  // 3. Obtener el fudo_table_id real si todavía es "pending"
  let fudoTableId: string = session.fudo_table_id;
  if (!fudoTableId || fudoTableId === "pending") {
    // Buscar en la tabla fudo_tables sincronizada
    const { data: tableRow } = await client
      .from("fudo_tables")
      .select("fudo_table_id")
      .eq("mesa_numero", session.mesa_numero)
      .single();
    if (!tableRow?.fudo_table_id) {
      throw new Error(`Sin fudo_table_id para mesa ${session.mesa_numero}. Sincronizar mesas primero.`);
    }
    fudoTableId = tableRow.fudo_table_id;
    await client
      .from("table_sessions")
      .update({ fudo_table_id: fudoTableId })
      .eq("id", session.id);
  }

  // 4. Obtener líneas del pedido (solo las principales — sin modificadores como hijos)
  const { data: lines, error: linesErr } = await client
    .from("order_lines")
    .select("line_id, fudo_product_id, quantity, unit_price, comment, parent_line_id")
    .eq("order_id", orderId)
    .is("parent_line_id", null);
  if (linesErr || !lines || lines.length === 0) throw new Error(`Sin líneas para pedido ${orderId}`);

  // 5. Abrir la cuenta en Fudo si es el primer pedido de la sesión
  let saleId: string = session.fudo_sale_id;
  if (!saleId) {
    saleId = await createSale(fudoTableId, session.people ?? 1);
    await client
      .from("table_sessions")
      .update({ fudo_sale_id: saleId, session_state: "OPEN" })
      .eq("id", session.id);
  }

  // 6. Marcar el pedido como en proceso
  await client
    .from("orders")
    .update({ status: "PROCESSING" })
    .eq("id", orderId);

  // 7. Enviar cada línea a Fudo
  for (const line of lines) {
    if (!line.fudo_product_id) {
      // Producto sin mapear → registrar en Supabase como SKIPPED y seguir
      await client
        .from("order_lines")
        .update({ status: "SKIPPED" })
        .eq("order_id", orderId)
        .eq("line_id", line.line_id);
      continue;
    }

    // Obtener modificadores hijos de esta línea
    const { data: mods } = await client
      .from("order_lines")
      .select("fudo_product_id, comment")
      .eq("order_id", orderId)
      .eq("parent_line_id", line.line_id);

    // Construir el comentario: aclaraciones del cliente + nombres de modificadores
    const parts: string[] = [];
    if (line.comment) parts.push(line.comment);
    if (mods && mods.length > 0) {
      parts.push(mods.map((m) => m.comment || m.fudo_product_id).join(", "));
    }
    const comment = parts.length > 0 ? parts.join(" · ") : undefined;

    const fudoItemId = await addSaleItem(
      saleId,
      line.fudo_product_id,
      line.quantity,
      line.unit_price,
      comment,
    );

    await client
      .from("order_lines")
      .update({ fudo_item_id: fudoItemId, status: "ACKNOWLEDGED" })
      .eq("order_id", orderId)
      .eq("line_id", line.line_id);
  }

  // 8. Pedido completo
  await client
    .from("orders")
    .update({ status: "REGISTERED" })
    .eq("id", orderId);
}
