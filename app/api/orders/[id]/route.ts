import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  // El cliente debe probar que creó este pedido enviando su idempotency key
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key || !UUID_RE.test(key)) {
    return NextResponse.json({ error: "key requerida" }, { status: 400 });
  }

  const sb = supabase();
  const { data: order, error } = await sb
    .from("orders")
    .select("id, status, created_at, idempotency_key")
    .eq("id", id)
    .eq("idempotency_key", key)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  const { data: lines } = await sb
    .from("order_lines")
    .select("line_id, product_id, quantity, unit_price, comment, status")
    .eq("order_id", id);

  return NextResponse.json({
    orderId: order.id,
    status: order.status,
    createdAt: order.created_at,
    lines: lines ?? [],
  });
}
