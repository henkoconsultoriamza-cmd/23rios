import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const ADMIN_COOKIE = "admin-session-v1";

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get(ADMIN_COOKIE);
  if (session?.value === "authenticated") {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "No autenticado" }, { status: 401 });
}
