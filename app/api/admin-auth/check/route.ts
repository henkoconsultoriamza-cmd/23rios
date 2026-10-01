import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";

export async function GET() {
  const valid = await verifyAdminSession();
  if (valid) return NextResponse.json({ ok: true });
  return NextResponse.json({ error: "No autenticado" }, { status: 401 });
}
