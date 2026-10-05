/**
 * GET  /api/fudo-tables  — diagnóstico de auth + listado de mesas desde Fudo
 * POST /api/fudo-tables  — sincroniza mesas Fudo → tabla fudo_tables en Supabase
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const AUTH_BASE = process.env.FUDO_AUTH_URL!; // https://auth.fu.do/api
const API_BASE  = process.env.FUDO_BASE_URL!; // https://api.fu.do/v1alpha1

const CANDIDATES = [
  `${AUTH_BASE}`,            // POST https://auth.fu.do/api
  `${AUTH_BASE}/auth`,       // POST https://auth.fu.do/api/auth
  `${AUTH_BASE}/login`,      // POST https://auth.fu.do/api/login
  `${AUTH_BASE}/token`,      // POST https://auth.fu.do/api/token
  `${AUTH_BASE}/v1/auth`,    // POST https://auth.fu.do/api/v1/auth
];

async function tryAuth(url: string) {
  const body = JSON.stringify({
    apiKey:    process.env.FUDO_API_KEY,
    apiSecret: process.env.FUDO_API_SECRET,
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* no es JSON */ }
    return { url, status: res.status, body: json ?? text };
  } catch (err) {
    return { url, status: 0, body: String(err) };
  }
}

export async function GET() {
  // Probar todas las variantes de auth
  const authResults = await Promise.all(CANDIDATES.map(tryAuth));
  const working = authResults.find(
    (r) => r.status >= 200 && r.status < 300
  );

  if (!working) {
    return NextResponse.json({ authResults }, { status: 502 });
  }

  // Con el token que funcionó, intentar traer las mesas
  const tokenBody = working.body as Record<string, unknown>;
  const token = (tokenBody?.token ?? tokenBody?.access_token) as string | undefined;

  let tablesRaw: unknown = null;
  let tablesStatus = 0;
  if (token) {
    const res = await fetch(`${API_BASE}/tables`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.api+json",
      },
      cache: "no-store",
    });
    tablesStatus = res.status;
    try { tablesRaw = await res.json(); } catch { tablesRaw = await res.text(); }
  }

  return NextResponse.json({
    authWorking: working.url,
    token: token ? `${token.slice(0, 20)}…` : null,
    tablesStatus,
    tables: tablesRaw,
  });
}

// ── POST — sincronizar mesas Fudo → Supabase ───────────────────────────────────
export async function POST() {
  const authResult = (await Promise.all(CANDIDATES.map(tryAuth))).find(
    (r) => r.status >= 200 && r.status < 300,
  );
  if (!authResult) {
    return NextResponse.json({ error: "Auth Fudo falló" }, { status: 502 });
  }

  const tokenBody = authResult.body as Record<string, unknown>;
  const token = (tokenBody?.token ?? tokenBody?.access_token) as string | undefined;
  if (!token) return NextResponse.json({ error: "Token no encontrado en respuesta" }, { status: 502 });

  const tablesRes = await fetch(`${API_BASE}/tables`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.api+json" },
    cache: "no-store",
  });
  if (!tablesRes.ok) {
    return NextResponse.json({ error: `Fudo /tables → ${tablesRes.status}` }, { status: 502 });
  }
  const tablesJson = await tablesRes.json() as { data: { id: string; attributes: { number?: number } }[] };
  const tables = tablesJson.data ?? [];

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const rows = tables.map((t) => ({
    restaurant_id: "local-a",
    mesa_numero: String(t.attributes?.number ?? t.id),
    fudo_table_id: t.id,
    qr_token: crypto.randomUUID(),
  }));

  const { error } = await supabase
    .from("fudo_tables")
    .upsert(rows, { onConflict: "mesa_numero" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ synced: rows.length, tables: rows });
}
