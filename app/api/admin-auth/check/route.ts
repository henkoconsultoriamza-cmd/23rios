import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin-auth";

// Responde quién está conectado: el correo (Supabase Auth) o el usuario de respaldo
export async function GET() {
  const user = await getAdminUser();
  if (user) return NextResponse.json({ ok: true, user });
  return NextResponse.json({ error: "No autenticado" }, { status: 401 });
}
