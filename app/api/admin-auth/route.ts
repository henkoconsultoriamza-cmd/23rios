import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const ADMIN_COOKIE = "admin-session-v1";
const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD_HASH =
  // SHA-256 de "restaurant-template-admin:menu2026"
  "b7e74a61c3f3d57d6167e1f1db6b8c5ae7e2f9a0c4d8b2e5f3a1c9d7e4b6f8a2";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function hashPassword(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`restaurant-template-admin:${value}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// POST /api/admin-auth — login
export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }

  // Buscar credenciales en Supabase
  const sb = supabase();
  const { data: creds } = await sb
    .from("admin_credentials")
    .select("username, password_hash")
    .eq("id", 1)
    .single();

  const expectedUsername = creds?.username ?? DEFAULT_USERNAME;
  const expectedHash = creds?.password_hash ?? DEFAULT_PASSWORD_HASH;
  const suppliedHash = await hashPassword(password);

  if (username.trim() !== expectedUsername || suppliedHash !== expectedHash) {
    // Delay para dificultar brute force
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }

  // Setear cookie httpOnly — no accesible desde JavaScript del cliente
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, "authenticated", {
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
  cookieStore.delete(ADMIN_COOKIE);
  return NextResponse.json({ ok: true });
}
