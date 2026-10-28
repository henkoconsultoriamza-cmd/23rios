import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const ADMIN_COOKIE = "admin-session-v1";
// Sesión de las personas del equipo: usuarios de Supabase Auth (se administran en el panel de Supabase)
export const STAFF_ACCESS_COOKIE = "admin-staff-access";
export const STAFF_REFRESH_COOKIE = "admin-staff-refresh";
const SESSION_SECONDS = 60 * 60 * 8; // 8 horas
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function supabaseAuth() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type StaffSession = { access_token: string; refresh_token: string };

/** Ingreso con correo y contraseña de Supabase Auth. Devuelve la sesión o null si no coinciden. */
export async function signInStaff(email: string, password: string): Promise<StaffSession | null> {
  const { data, error } = await supabaseAuth().auth.signInWithPassword({ email, password });
  return error || !data.session ? null : data.session;
}

export async function setStaffCookies(session: StaffSession) {
  const cookieStore = await cookies();
  const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, maxAge: SESSION_SECONDS, path: "/" };
  cookieStore.set(STAFF_ACCESS_COOKIE, session.access_token, options);
  cookieStore.set(STAFF_REFRESH_COOKIE, session.refresh_token, options);
}

export async function clearStaffCookies() {
  const cookieStore = await cookies();
  cookieStore.delete(STAFF_ACCESS_COOKIE);
  cookieStore.delete(STAFF_REFRESH_COOKIE);
}

/**
 * Quién está usando el admin: el correo de la persona (Supabase Auth) o el usuario
 * propio del admin (tabla admin_credentials, de respaldo). null = sin sesión.
 */
export async function getAdminUser(): Promise<string | null> {
  const cookieStore = await cookies();

  const access = cookieStore.get(STAFF_ACCESS_COOKIE)?.value;
  if (access) {
    const { data } = await supabase().auth.getUser(access);
    if (data.user?.email) return data.user.email;
  }
  // El acceso de Supabase dura una hora: se renueva con el refresh mientras la sesión siga vigente
  const refresh = cookieStore.get(STAFF_REFRESH_COOKIE)?.value;
  if (refresh) {
    const { data } = await supabaseAuth().auth.refreshSession({ refresh_token: refresh });
    if (data.session && data.user?.email) {
      await setStaffCookies(data.session).catch(() => undefined);
      return data.user.email;
    }
  }

  const token = cookieStore.get(ADMIN_COOKIE)?.value;
  if (token && UUID_RE.test(token)) {
    const { data } = await supabase()
      .from("admin_credentials")
      .select("username")
      .eq("session_token", token)
      .limit(1)
      .maybeSingle();
    if (data) return data.username as string;
  }
  return null;
}

/** Verifica que haya una sesión válida del admin (persona del equipo o usuario de respaldo). */
export async function verifyAdminSession(): Promise<boolean> {
  return (await getAdminUser()) !== null;
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
