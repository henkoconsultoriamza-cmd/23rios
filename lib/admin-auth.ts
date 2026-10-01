import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const ADMIN_COOKIE = "admin-session-v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Verifica que la cookie de sesión existe y coincide con el token guardado en DB. */
export async function verifyAdminSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;
  if (!token || !UUID_RE.test(token)) return false;

  const { data } = await supabase()
    .from("admin_credentials")
    .select("id")
    .eq("session_token", token)
    .limit(1)
    .single();

  return !!data;
}

// ─── PBKDF2 ──────────────────────────────────────────────────────────────────
// Formato en DB: pbkdf2:<iterations>:<salt_hex>:<hash_hex>

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100_000;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  const toHex = (buf: ArrayBuffer) =>
    Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `pbkdf2:${iterations}:${saltHex}:${toHex(derived)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith("pbkdf2:")) return false;
  const parts = stored.split(":");
  if (parts.length !== 4) return false;

  const iterations = parseInt(parts[1], 10);
  const salt = new Uint8Array(parts[2].match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const storedHash = parts[3];

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  const computedHash = Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Comparación en tiempo constante (evita timing attacks)
  if (computedHash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHash.length; i++) {
    diff |= computedHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}
