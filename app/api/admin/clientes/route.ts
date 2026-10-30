/**
 * GET /api/admin/clientes — Excel con el nombre y el teléfono de quienes lanzaron pedidos desde el menú.
 * Una fila por persona (por teléfono o, si no lo dejó, por nombre), la más reciente arriba.
 */
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Los pedidos anteriores eran de prueba: la lista de clientes arranca acá
const CLIENTES_DESDE = "2026-10-30T13:15:00-03:00";
// Argentina no tiene horario de verano: la hora local es UTC-3 todo el año
const ARGENTINA_OFFSET_MS = 3 * 60 * 60 * 1000;
const PAGE = 1000;

type OrderRow = { customer_name: string | null; customer_phone: string | null; created_at: string };
type Person = { name: string; phone: string; orders: number; last: string };

export async function GET() {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const orders: OrderRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("orders")
      .select("customer_name, customer_phone, created_at")
      .gte("created_at", CLIENTES_DESDE)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: "No se pudieron leer los pedidos" }, { status: 500 });
    orders.push(...data);
    if (data.length < PAGE) break;
  }

  // Los pedidos vienen del más viejo al más nuevo: el último nombre y teléfono que dejó la persona es el que queda
  const people = new Map<string, Person>();
  for (const order of orders) {
    const name = order.customer_name?.trim() ?? "";
    const phone = order.customer_phone?.trim() ?? "";
    if (!name && !phone) continue;
    // Últimos diez dígitos: «+54 9 261 555-0001» y «2615550001» son la misma persona
    const key = phone ? `tel:${phone.replace(/\D/g, "").slice(-10)}` : `nombre:${name.toLocaleLowerCase("es")}`;
    const known = people.get(key);
    people.set(key, { name: name || known?.name || "", phone: phone || known?.phone || "", orders: (known?.orders ?? 0) + 1, last: order.created_at });
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Clientes", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Nombre", key: "name", width: 32 },
    { header: "Teléfono", key: "phone", width: 22 },
    { header: "Pedidos", key: "orders", width: 10 },
    { header: "Último pedido", key: "last", width: 18, style: { numFmt: "dd/mm/yyyy hh:mm" } },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const person of [...people.values()].sort((a, b) => b.last.localeCompare(a.last))) {
    sheet.addRow({ ...person, last: new Date(Date.parse(person.last) - ARGENTINA_OFFSET_MS) });
  }
  sheet.autoFilter = { from: "A1", to: "D1" };

  const today = new Date(Date.now() - ARGENTINA_OFFSET_MS).toISOString().slice(0, 10);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Clientes_23_Rios_${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
