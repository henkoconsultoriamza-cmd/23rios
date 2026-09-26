/**
 * Seed inicial de Supabase para 23 Rios.
 * Inserta todos los datos por defecto en restaurant_config y admin_credentials.
 *
 * Uso:
 *   1. Agregar SUPABASE_SERVICE_ROLE_KEY en .env.local
 *   2. npx tsx scripts/seed.ts
 */

import { createClient } from "@supabase/supabase-js";
import { DEFAULT_PRODUCTS, DEFAULT_MENU_SETTINGS, DEFAULT_APP_SETTINGS } from "../app/menu-data";
import { DEFAULT_BANNERS } from "../app/banner-data";
import { DEFAULT_PORTAL_SETTINGS } from "../app/portal-data";

// Lee .env.local manualmente (tsx no carga dotenv automaticamente)
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
const envVars: Record<string, string> = {};
try {
  readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const [key, ...rest] = line.split("=");
      if (key && rest.length) envVars[key.trim()] = rest.join("=").trim();
    });
} catch {
  console.error("No se encontro .env.local");
  process.exit(1);
}

const url = envVars["NEXT_PUBLIC_SUPABASE_URL"];
const serviceKey = envVars["SUPABASE_SERVICE_ROLE_KEY"];

if (!url || !serviceKey) {
  console.error(
    "Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local\n" +
    "Consegui la service_role key en Supabase -> Settings -> API"
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

// Hash de la contrasena por defecto: "menu2026"
async function hashPassword(value: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256")
    .update(`restaurant-template-admin:${value}`)
    .digest("hex");
}

async function seed() {
  console.log("Iniciando seed en:", url);

  // 1. restaurant_config
  const configRows = [
    { key: "products",        value: DEFAULT_PRODUCTS },
    { key: "menu_settings",   value: DEFAULT_MENU_SETTINGS },
    { key: "app_settings",    value: DEFAULT_APP_SETTINGS },
    { key: "banners",         value: DEFAULT_BANNERS },
    { key: "promos",          value: [] },
    { key: "events",          value: [] },
    { key: "portal_settings", value: DEFAULT_PORTAL_SETTINGS },
  ];

  for (const row of configRows) {
    const { error } = await supabase
      .from("restaurant_config")
      .upsert({ key: row.key, value: row.value }, { onConflict: "key" });
    if (error) {
      console.error(`Error en ${row.key}:`, error.message);
    } else {
      console.log(`OK  restaurant_config["${row.key}"]`);
    }
  }

  // 2. admin_credentials (contrasena por defecto: menu2026)
  const passwordHash = await hashPassword("menu2026");
  const { error: credError } = await supabase
    .from("admin_credentials")
    .upsert({ id: 1, username: "admin", password_hash: passwordHash }, { onConflict: "id" });
  if (credError) {
    console.error("Error en admin_credentials:", credError.message);
  } else {
    console.log("OK  admin_credentials (usuario: admin / contrasena: menu2026)");
  }

  console.log("\nSeed completado.");
}

seed().catch((err) => {
  console.error("Error inesperado:", err);
  process.exit(1);
});
