import { supabase } from "./index";
import { Product, MenuSettings, AppSettings, Promo } from "../app/menu-data";
import { Banner } from "../app/banner-data";
import { EventItem } from "../app/event-data";
import { PortalSettings } from "../app/portal-data";
import { AnalyticsEvent } from "../app/analytics";

// ── Leer una clave de restaurant_config ──────────────────────────
async function getConfig<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from("restaurant_config")
    .select("value")
    .eq("key", key)
    .single();
  if (error || !data) return null;
  return data.value as T;
}

// ── Escribir una clave de restaurant_config ──────────────────────
async function setConfig<T>(key: string, value: T): Promise<void> {
  await supabase
    .from("restaurant_config")
    .upsert({ key, value }, { onConflict: "key" });
}

// ── Productos ────────────────────────────────────────────────────
export const getProducts = () => getConfig<Product[]>("products");
export const saveProducts = (v: Product[]) => setConfig("products", v);

// ── Ajustes del menu ─────────────────────────────────────────────
export const getMenuSettings = () => getConfig<MenuSettings>("menu_settings");
export const saveMenuSettings = (v: MenuSettings) => setConfig("menu_settings", v);

// ── Ajustes del negocio ──────────────────────────────────────────
export const getAppSettings = () => getConfig<AppSettings>("app_settings");
export const saveAppSettings = (v: AppSettings) => setConfig("app_settings", v);

// ── Banners ──────────────────────────────────────────────────────
export const getBanners = () => getConfig<Banner[]>("banners");
export const saveBanners = (v: Banner[]) => setConfig("banners", v);

// ── Promos ───────────────────────────────────────────────────────
export const getPromos = () => getConfig<Promo[]>("promos");
export const savePromos = (v: Promo[]) => setConfig("promos", v);

// ── Eventos ──────────────────────────────────────────────────────
export const getEvents = () => getConfig<EventItem[]>("events");
export const saveEvents = (v: EventItem[]) => setConfig("events", v);

// ── Portal ───────────────────────────────────────────────────────
export const getPortalSettings = () => getConfig<PortalSettings>("portal_settings");
export const savePortalSettings = (v: PortalSettings) => setConfig("portal_settings", v);

// ── Credenciales admin ───────────────────────────────────────────
export async function getAdminCredentials(): Promise<{ username: string; password_hash: string } | null> {
  const { data, error } = await supabase
    .from("admin_credentials")
    .select("username, password_hash")
    .eq("id", 1)
    .single();
  if (error || !data) return null;
  return data;
}

export async function saveAdminCredentials(username: string, passwordHash: string): Promise<void> {
  await supabase
    .from("admin_credentials")
    .upsert({ id: 1, username, password_hash: passwordHash }, { onConflict: "id" });
}

// ── Analíticas ───────────────────────────────────────────────────
export async function insertAnalyticsEvent(event: AnalyticsEvent): Promise<void> {
  await supabase.from("analytics_events").insert({
    id: event.id,
    type: event.type,
    session_id: event.sessionId,
    timestamp: event.timestamp,
    product_id: event.productId ?? null,
    related_product_id: event.relatedProductId ?? null,
    language: event.language ?? null,
    banner_id: event.bannerId ?? null,
    filter_name: event.filterName ?? null,
    filter_type: event.filterType ?? null,
  });
}

export async function fetchAnalyticsEvents(): Promise<AnalyticsEvent[]> {
  const { data, error } = await supabase
    .from("analytics_events")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(5000);
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    type: row.type,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    productId: row.product_id ?? undefined,
    relatedProductId: row.related_product_id ?? undefined,
    language: row.language ?? undefined,
    bannerId: row.banner_id ?? undefined,
    filterName: row.filter_name ?? undefined,
    filterType: row.filter_type ?? undefined,
  }));
}

export async function clearAnalyticsEvents(): Promise<void> {
  await supabase.from("analytics_events").delete().neq("id", "");
}

// ── Storage: subir imagen al bucket menu-images ──────────────────
export async function uploadImage(file: File, folder: string): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${folder}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("menu-images").upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("menu-images").getPublicUrl(path);
  return data.publicUrl;
}

// ── Realtime: suscribirse a cambios en restaurant_config ─────────
export function subscribeToConfig(onUpdate: (key: string, value: unknown) => void) {
  return supabase
    .channel("restaurant_config_changes")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "restaurant_config" },
      (payload) => {
        const row = payload.new as { key: string; value: unknown };
        onUpdate(row.key, row.value);
      }
    )
    .subscribe();
}
