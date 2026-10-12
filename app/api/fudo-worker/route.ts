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
import { sendOrderToFudo, FudoIntegrationsError } from "@/app/lib/fudo/integrations-client";

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
      const msg = err instanceof FudoIntegrationsError
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
  // 1. Obtener el pedido con datos del cliente
  const { data: order, error: orderErr } = await client
    .from("orders")
    .select("id, table_session_id, status, customer_name, customer_phone, customer_email")
    .eq("id", orderId)
    .single();
  if (orderErr || !order) throw new Error(`Pedido ${orderId} no encontrado`);
  if (order.status === "REGISTERED") return; // ya procesado — idempotente

  // 2. Obtener la sesión de mesa
  const { data: session, error: sessErr } = await client
    .from("table_sessions")
    .select("id, mesa_numero, people")
    .eq("id", order.table_session_id)
    .single();
  if (sessErr || !session) throw new Error(`Sesión no encontrada para pedido ${orderId}`);

  // 3. Obtener líneas del pedido (solo las principales — sin modificadores como hijos)
  const { data: lines, error: linesErr } = await client
    .from("order_lines")
    .select("line_id, fudo_product_id, fudo_category_id, quantity, unit_price, comment, parent_line_id")
    .eq("order_id", orderId)
    .is("parent_line_id", null);
  if (linesErr || !lines || lines.length === 0) throw new Error(`Sin líneas para pedido ${orderId}`);

  // 4. Marcar como en proceso
  await client.from("orders").update({ status: "PROCESSING" }).eq("id", orderId);

  // 5. Armar los ítems para FUDO — saltear los que no tienen mapeo
  const fudoItems = lines
    .filter((l) => l.fudo_product_id && l.fudo_category_id)
    .map((l) => ({
      productId: Number(l.fudo_product_id),
      productCategoryId: Number(l.fudo_category_id),
      price: l.unit_price,
      quantity: l.quantity,
      subitems: [],
    }));

  if (fudoItems.length === 0) throw new Error(`Pedido ${orderId} sin ítems mapeados a FUDO`);

  const total = fudoItems.reduce((s, i) => s + i.price * i.quantity, 0);

  // 6. Enviar a FUDO via integrations endpoint
  const result = await sendOrderToFudo({
    customerName: order.customer_name ?? "Cliente",
    customerPhone: order.customer_phone ?? undefined,
    customerEmail: order.customer_email ?? undefined,
    tableNumber: Number(session.mesa_numero),
    people: session.people ?? 1,
    items: fudoItems,
    total,
  });

  // 7. Marcar líneas enviadas y guardar referencia de FUDO
  await client
    .from("order_lines")
    .update({ status: "ACKNOWLEDGED" })
    .eq("order_id", orderId)
    .is("parent_line_id", null);

  // Marcar líneas sin mapeo como SKIPPED
  await client
    .from("order_lines")
    .update({ status: "SKIPPED" })
    .eq("order_id", orderId)
    .is("fudo_product_id", null);

  // 8. Pedido completo — guardar saleId y orderId de FUDO
  await client
    .from("orders")
    .update({
      status: "REGISTERED",
      fudo_sale_id: String(result.saleId),
      fudo_order_id: String(result.orderId),
    })
    .eq("id", orderId);
}
