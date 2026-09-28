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

// ── Fudo config (dentro de restaurant_config) ───────────────────
export interface FudoConfig {
  fudoEnabled: boolean;
  catalogRevision: string;
  sessionTimeoutHours: number;
  restaurantToken?: string; // Token general para Modo A (un QR para todo el local)
}

export const getFudoConfig = () => getConfig<FudoConfig>("fudo_config");
export const saveFudoConfig = (v: FudoConfig) => setConfig("fudo_config", v);

// ── Fudo tables — mesas del local ────────────────────────────────
export interface FudoTable {
  id: string;
  restaurant_id: string;
  mesa_numero: string;
  fudo_table_id: string;
  qr_token: string;
  active: boolean;
}

export async function getFudoTables(): Promise<FudoTable[]> {
  const { data, error } = await supabase
    .from("fudo_tables")
    .select("*")
    .eq("active", true)
    .order("mesa_numero");
  if (error || !data) return [];
  return data as FudoTable[];
}

export async function saveFudoTable(table: Omit<FudoTable, "id" | "restaurant_id">): Promise<void> {
  await supabase.from("fudo_tables").upsert(table, { onConflict: "qr_token" });
}

// ── Table sessions ───────────────────────────────────────────────
export type SessionState = "READY" | "OPENING" | "OPEN_UNKNOWN" | "OPEN" | "CHECKOUT" | "CLOSED";

export interface TableSession {
  id: string;
  restaurant_id: string;
  fudo_table_id: string;
  fudo_sale_id: string | null;
  people: number;
  session_state: SessionState;
  opening_body: object | null;
  created_at: string;
  closed_at: string | null;
}

export async function getActiveSession(fudoTableId: string): Promise<TableSession | null> {
  const { data, error } = await supabase
    .from("table_sessions")
    .select("*")
    .eq("fudo_table_id", fudoTableId)
    .neq("session_state", "CLOSED")
    .maybeSingle();
  if (error || !data) return null;
  return data as TableSession;
}

// ── Orders ───────────────────────────────────────────────────────
export type OrderStatus = "RECEIVED" | "PROCESSING" | "REGISTERED" | "REQUIRES_REVIEW";

export interface FudoOrder {
  id: string;
  restaurant_id: string;
  table_session_id: string;
  idempotency_key: string;
  catalog_revision: string;
  body_hash: string;
  status: OrderStatus;
  created_at: string;
}

export async function getOrderById(orderId: string): Promise<FudoOrder | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return null;
  return data as FudoOrder;
}

// ── Order lines ──────────────────────────────────────────────────
export type LineStatus = "PENDING" | "SENDING" | "ACKNOWLEDGED" | "VERIFIED" | "REJECTED" | "UNKNOWN";

export interface OrderLine {
  id: string;
  order_id: string;
  line_id: string;
  product_id: string;
  fudo_product_id: string;
  serving: string | null;
  quantity: number;
  unit_price_minor: number;
  comment: string | null;
  fudo_item_id: string | null;
  status: LineStatus;
}

export async function getOrderLines(orderId: string): Promise<OrderLine[]> {
  const { data, error } = await supabase
    .from("order_lines")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at");
  if (error || !data) return [];
  return data as OrderLine[];
}

// ── Storage: subir imagen vía endpoint seguro del servidor ────────
export async function uploadImage(file: File, folder: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Error al subir la imagen.");
  return json.url as string;
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
