/**
 * Envío de pedidos a FUDO por el canal del menú QR (integrations.fu.do/fudo/orders), el mismo
 * que usa menu.fu.do cuando un cliente pide desde la mesa. No es la API oficial de FUDO.
 * Reemplaza al worker que corría en Railway (worker/index.js): misma lógica, sin servidor aparte.
 *
 * Cola: order_outbox. Cada pedido se reserva con un UPDATE condicional (PENDING → PROCESSING
 * con lease) antes de mandarlo, así nunca lo envían dos procesos a la vez.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const FUDO_ORDERS_URL = "https://integrations.fu.do/fudo/orders/";
const FUDO_PRODUCTS_URL = "https://integrations.fu.do/fudo/products/?a=23rios";
const FUDO_ACCOUNT_URL = "https://integrations.fu.do/fudo/account/?a=23rios";
const FUDO_ACCOUNT_ID = process.env.FUDO_ACCOUNT_ID ?? "MjNyaW9z"; // base64 de "23rios"
const FUDO_HEADERS = {
  "Content-Type": "application/json",
  "fudo-app": "self-service",
  "fudo-account-id": FUDO_ACCOUNT_ID,
  "origin": "https://menu.fu.do",
  "referer": "https://menu.fu.do/",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "accept": "application/json, text/plain, */*",
};

const PRODUCTS_TTL_MS = 5 * 60_000;
const LEASE_MS = 60_000;
/** Un pedido que no salió en este tiempo ya no se manda: cocina lo recibiría tarde */
const MAX_ORDER_AGE_MS = 15 * 60_000;
/** Reintentos ante errores pasajeros (FUDO caído, red). Un rechazo de FUDO no se reintenta. */
const MAX_ATTEMPTS = 3;
/** Grupos de opciones de los combos de 2,25 L, por si FUDO no devuelve la ficha del producto */
const COMBO_SUBITEM_GROUPS: Record<string, number> = { "49": 4, "148": 6 };

type QrGroup = { id: number; productGroupProducts: { productId: number; price: number }[] };
type QrProduct = { id: number; name: string; price: number; productCategoryId: number; productGroups?: QrGroup[] };
type Subitem = { price: number; productGroupId: number; productId: number; quantity: number };
type FudoItem = { subitems: Subitem[]; price: number; productCategoryId: number; productId: number; quantity: number; comment?: string };

/** FUDO rechazó el pedido o el pedido no se puede armar: reintentar no sirve */
class FudoRejected extends Error {}

let makeClient = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
/** Solo para pruebas: reemplaza el cliente de Supabase */
export function setSupabaseClientForTests(factory: () => SupabaseClient) { makeClient = factory; }

function admin(): SupabaseClient {
  return makeClient();
}

// ── Catálogo de FUDO (precio, categoría y grupos de opciones vigentes) ──────────
let productsCache: { byId: Map<string, QrProduct>; at: number } | null = null;

async function getFudoProducts(): Promise<Map<string, QrProduct> | null> {
  if (productsCache && Date.now() - productsCache.at < PRODUCTS_TTL_MS) return productsCache.byId;
  try {
    const res = await fetch(FUDO_PRODUCTS_URL, { headers: FUDO_HEADERS, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { products } = (await res.json()) as { products: QrProduct[] };
    productsCache = { byId: new Map(products.map((p) => [String(p.id), p])), at: Date.now() };
    return productsCache.byId;
  } catch (err) {
    console.error("[fudo] No se pudo leer el catálogo:", err instanceof Error ? err.message : err);
    return productsCache?.byId ?? null; // si falla, la última lista conocida
  }
}

// El precio y la categoría salen de FUDO: si no coinciden con los suyos, rechaza el pedido
function resolvePrice(pid: string, menuPrice: number, menuCategoryId: number, products: Map<string, QrProduct> | null) {
  const fp = products?.get(pid);
  if (!fp) {
    if (products) console.warn(`[fudo] ⚠ producto ${pid} no figura en el menú QR de FUDO`);
    return { price: menuPrice, categoryId: menuCategoryId };
  }
  if (menuPrice && menuPrice !== fp.price) {
    console.warn(`[fudo] ⚠ precio desactualizado en el menú: ${fp.name} (${pid}) menú $${menuPrice} · FUDO $${fp.price}`);
  }
  return { price: fp.price, categoryId: fp.productCategoryId };
}

// Opciones elegidas (líneas hijas) → subitems. Una opción repetida (ej. dos Golden) va con quantity 2.
function buildSubitems(pid: string, children: { fudo_product_id: string | null }[], products: Map<string, QrProduct> | null): Subitem[] {
  const groups = products?.get(pid)?.productGroups ?? [];
  const byProduct = new Map<number, Subitem>();
  for (const child of children) {
    if (!child.fudo_product_id) continue;
    const cid = parseInt(child.fudo_product_id);
    const group = groups.find((g) => g.productGroupProducts.some((o) => o.productId === cid));
    const productGroupId = group?.id ?? COMBO_SUBITEM_GROUPS[pid];
    if (!productGroupId) {
      console.warn(`[fudo] ⚠ la opción ${cid} no está en ningún grupo del producto ${pid} en FUDO`);
      continue;
    }
    const current = byProduct.get(cid);
    if (current) current.quantity += 1;
    else byProduct.set(cid, { price: group?.productGroupProducts.find((o) => o.productId === cid)?.price ?? 0, productGroupId, productId: cid, quantity: 1 });
  }
  return [...byProduct.values()];
}

// ── Teléfono del local ─────────────────────────────────────────────────────────
// FUDO rechaza el pedido entero si el teléfono va vacío (minLength), y en la carta es opcional:
// si el cliente no lo dejó, va el del local (Ajustes del admin o, si está vacío, el de contacto
// del menú QR de FUDO).
let venuePhoneCache: { phone: string; at: number } | null = null;

async function venuePhone(sb: SupabaseClient): Promise<string> {
  if (venuePhoneCache && Date.now() - venuePhoneCache.at < PRODUCTS_TTL_MS) return venuePhoneCache.phone;
  const { data } = await sb.from("restaurant_config").select("value").eq("key", "app_settings").maybeSingle();
  let phone = String((data?.value as { phone?: string } | undefined)?.phone ?? "").trim();
  if (!phone) {
    try {
      const res = await fetch(FUDO_ACCOUNT_URL, { headers: FUDO_HEADERS, cache: "no-store" });
      const json = res.ok ? await res.json() : null;
      phone = String((json?.account ?? json)?.settings?.qrMenu?.contact?.phone ?? "").trim();
    } catch {
      // sin FUDO: queda el de reserva
    }
  }
  phone ||= "0000000000";
  venuePhoneCache = { phone, at: Date.now() };
  return phone;
}

// ── Un pedido ──────────────────────────────────────────────────────────────────
async function sendOrder(sb: SupabaseClient, orderId: string): Promise<void> {
  const { data: order } = await sb.from("orders")
    .select("id, table_session_id, customer_name, customer_phone, status").eq("id", orderId).single();
  if (!order) throw new FudoRejected(`Pedido ${orderId} no encontrado`);
  if (order.status === "REGISTERED") return; // ya enviado

  const [{ data: session }, { data: lines }, { data: children }] = await Promise.all([
    sb.from("table_sessions").select("mesa_numero, fudo_table_id, people").eq("id", order.table_session_id).single(),
    sb.from("order_lines").select("line_id, fudo_product_id, fudo_category_id, quantity, unit_price, comment")
      .eq("order_id", orderId).is("parent_line_id", null),
    sb.from("order_lines").select("parent_line_id, fudo_product_id").eq("order_id", orderId).not("parent_line_id", "is", null),
  ]);

  const childrenByParent = new Map<string, { fudo_product_id: string | null }[]>();
  for (const c of children ?? []) childrenByParent.set(c.parent_line_id, [...(childrenByParent.get(c.parent_line_id) ?? []), c]);

  const products = await getFudoProducts();
  const grouped = new Map<string, Omit<FudoItem, "quantity"> & { quantity: number }>();
  const items: FudoItem[] = [];

  for (const line of (lines ?? []).filter((l) => l.fudo_product_id)) {
    const pid = String(line.fudo_product_id);
    const { price, categoryId } = resolvePrice(pid, Number(line.unit_price) || 0, Number(line.fudo_category_id) || 0, products);
    const subitems = buildSubitems(pid, childrenByParent.get(line.line_id) ?? [], products);
    if (line.comment) {
      // Con comentario (ej. «Sin cebolla»): va por separado para conservar la nota
      for (let i = 0; i < line.quantity; i++) {
        items.push({ subitems, price, productCategoryId: categoryId, productId: parseInt(pid), quantity: 1, comment: line.comment });
      }
    } else {
      // Producto, combo o promo: se agrupa por producto + opciones elegidas
      const key = `${pid}:${subitems.map((s) => `${s.productId}x${s.quantity}`).join(",")}`;
      const g = grouped.get(key) ?? { subitems, price, productCategoryId: categoryId, productId: parseInt(pid), quantity: 0 };
      g.quantity += line.quantity;
      grouped.set(key, g);
    }
  }
  // FUDO recibe cada unidad como un ítem aparte
  for (const g of grouped.values()) for (let i = 0; i < g.quantity; i++) items.push({ ...g, quantity: 1 });

  if (items.length === 0) throw new FudoRejected(`Pedido ${orderId} sin productos vinculados a FUDO`);

  const total = items.reduce((sum, i) => sum + (i.price + i.subitems.reduce((s, sub) => s + sub.price * sub.quantity, 0)) * i.quantity, 0);
  const payload = {
    order: {
      customer: { dataCollectionEnabled: false, name: order.customer_name || "Cliente", phone: order.customer_phone?.trim() || (await venuePhone(sb)) },
      items,
      payment: { total },
      people: session?.people || 1,
      shippingCost: 0,
      tableNumber: parseInt(session?.fudo_table_id || session?.mesa_numero || "1"),
      type: "self-service",
      typeOptions: {},
    },
  };

  const res = await fetch(FUDO_ORDERS_URL, { method: "POST", headers: FUDO_HEADERS, body: JSON.stringify(payload), cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 400) productsCache = null; // FUDO cambió algo: releer su lista
    const message = `FUDO HTTP ${res.status}: ${body.slice(0, 600)}`;
    throw res.status >= 400 && res.status < 500 ? new FudoRejected(message) : new Error(message);
  }

  await sb.from("orders").update({ status: "REGISTERED" }).eq("id", orderId);
}

// ── La cola ────────────────────────────────────────────────────────────────────
export type OutboxResult = { sent: number; failed: number; retried: number; expired: number };

/** Manda a FUDO los pedidos pendientes de los últimos minutos. Se puede llamar las veces que sea. */
export async function processOutbox(): Promise<OutboxResult> {
  const sb = admin();
  const now = new Date();
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - MAX_ORDER_AGE_MS).toISOString();
  const result: OutboxResult = { sent: 0, failed: 0, retried: 0, expired: 0 };

  // Pendientes que ya no conviene mandar (del último día; lo anterior queda como está)
  const { data: stale } = await sb.from("order_outbox")
    .update({ status: "FAILED", leased_until: null, error_message: "No se pudo enviar a FUDO a tiempo: cargalo a mano si sigue pendiente." })
    .eq("status", "PENDING").lt("created_at", since).gte("created_at", new Date(now.getTime() - 24 * 3600_000).toISOString())
    .select("id");
  result.expired = stale?.length ?? 0;

  // Pendientes recientes, o en proceso con la reserva vencida (un proceso que se cortó a la mitad)
  const { data: candidates, error } = await sb.from("order_outbox")
    .select("id, order_id, status, attempts")
    .gte("created_at", since)
    .or(`status.eq.PENDING,and(status.eq.PROCESSING,leased_until.lt.${nowIso})`)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(`No se pudo leer la cola: ${error.message}`);

  await Promise.all((candidates ?? []).map(async (item) => {
    const attempts = (item.attempts ?? 0) + 1;
    // Reserva: solo sigue si nadie la tomó entre la lectura y ahora
    let claim = sb.from("order_outbox")
      .update({ status: "PROCESSING", leased_until: new Date(Date.now() + LEASE_MS).toISOString(), attempts })
      .eq("id", item.id).eq("status", item.status);
    if (item.status === "PROCESSING") claim = claim.lt("leased_until", nowIso);
    const { data: claimed } = await claim.select("id");
    if (!claimed?.length) return;

    try {
      await sendOrder(sb, item.order_id);
      await sb.from("order_outbox").update({ status: "DONE", leased_until: null, error_message: null }).eq("id", item.id);
      result.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const giveUp = err instanceof FudoRejected || attempts >= MAX_ATTEMPTS;
      console.error(`[fudo] ✗ ${item.order_id} (intento ${attempts}): ${message}`);
      await sb.from("order_outbox")
        .update({ status: giveUp ? "FAILED" : "PENDING", leased_until: null, error_message: message })
        .eq("id", item.id);
      if (giveUp) result.failed++; else result.retried++;
    }
  }));

  return result;
}
