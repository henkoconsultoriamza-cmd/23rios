/**
 * Lectura y escritura de restaurant_config desde el servidor (service role).
 * Solo para API routes que ya verificaron la sesión del admin.
 */
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function readConfig<T>(key: string): Promise<T | null> {
  const { data, error } = await admin().from("restaurant_config").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`No se pudo leer ${key}: ${error.message}`);
  return (data?.value as T) ?? null;
}

export async function writeConfig<T>(key: string, value: T): Promise<void> {
  const { error } = await admin().from("restaurant_config").upsert({ key, value }, { onConflict: "key" });
  if (error) throw new Error(`No se pudo guardar ${key}: ${error.message}`);
}

/**
 * Aplica sobre la versión guardada solo los campos que cambió el admin.
 * Un campo en null se borra. Así una pestaña abierta hace rato no pisa lo que cambió otra.
 */
export function applyFields<T extends object>(current: T, fields: Record<string, unknown>): T {
  const next = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    if (key === "id") continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as T;
}
