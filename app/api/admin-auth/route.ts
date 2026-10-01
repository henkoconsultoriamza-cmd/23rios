import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyPassword } from "@/lib/admin-auth";

// ─── Rate limiting estricto (brute force) ────────────────────────────────────
// 5 intentos fallidos por IP en 15 minutos.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/admin-auth — login
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkLoginRateLimit(ip)) {
    return NextResponse.json({ error: "Demasiados intentos. Esperá 15 minutos." }, { status: 429 });
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password || typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }

  // Siempre buscar credenciales en Supabase (no hay fallback hardcodeado)
  const sb = supabase();
  const { data: creds } = await sb
    .from("admin_credentials")
    .select("id, username, password_hash")
    .eq("id", 1)
    .single();

  // Delay constante para evitar timing attacks y brute force
  await new Promise((r) => setTimeout(r, 500));

  const credentialsMatch =
    creds &&
    username.trim() === creds.username &&
    (await verifyPassword(password, creds.password_hash));

  if (!credentialsMatch) {
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }

  // Generar token de sesión aleatorio y guardarlo en DB
  const sessionToken = crypto.randomUUID();
  await sb
    .from("admin_credentials")
    .update({ session_token: sessionToken })
    .eq("id", 1);

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 8, // 8 horas
    path: "/",
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin-auth — logout
export async function DELETE() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;

  // Invalidar token en DB
  if (token) {
    await supabase()
      .from("admin_credentials")
      .update({ session_token: null })
      .eq("session_token", token);
  }

  cookieStore.delete(ADMIN_COOKIE);
  return NextResponse.json({ ok: true });
}
