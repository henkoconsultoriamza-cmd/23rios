import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sb = supabase();

  const { data: order, error } = await sb
    .from("orders")
    .select("id, status, created_at, table_session_id")
    .eq("id", id)
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
