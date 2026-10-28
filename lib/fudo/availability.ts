/**
 * Qué se puede pedir ahora en FUDO: los productos que figuran en el menú QR de FUDO
 * y no están marcados como no disponibles, y qué opciones acepta cada uno (ej. la gaseosa
 * de un combo). Si un pedido lleva un producto desactivado, o una opción que FUDO no tiene
 * cargada en ese producto, FUDO rechaza el pedido entero (notAvailable): por eso la carta
 * no los muestra y los saca del carrito antes de lanzar.
 */
const FUDO_PRODUCTS_URL = "https://integrations.fu.do/fudo/products/?a=23rios";
const FUDO_ACCOUNT_ID = process.env.FUDO_ACCOUNT_ID ?? "MjNyaW9z"; // base64 de "23rios"
const TTL_MS = 60_000;

type QrProduct = {
  id: number;
  isAvailable?: boolean;
  productGroups?: { productGroupProducts: { productId: number }[] }[];
};

export type FudoAvailability = {
  ids: string[];
  /** Producto con grupos de opciones → IDs de las opciones que FUDO acepta */
  options: Record<string, string[]>;
};

let cache: { data: FudoAvailability; at: number } | null = null;

/** Disponibilidad en FUDO, o null si no se pudo consultar (en ese caso no se oculta nada). */
export async function getFudoAvailability(): Promise<FudoAvailability | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const res = await fetch(FUDO_PRODUCTS_URL, {
      headers: { "fudo-app": "self-service", "fudo-account-id": FUDO_ACCOUNT_ID },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { products } = (await res.json()) as { products?: QrProduct[] };
    // Una lista vacía es un error de FUDO, no «nada disponible»: no se oculta la carta entera
    if (!Array.isArray(products) || products.length === 0) throw new Error("FUDO devolvió la lista vacía");
    const options: Record<string, string[]> = {};
    for (const p of products) {
      if (!p.productGroups?.length) continue;
      options[String(p.id)] = p.productGroups.flatMap((g) => g.productGroupProducts.map((o) => String(o.productId)));
    }
    const data = { ids: products.filter((p) => p.isAvailable !== false).map((p) => String(p.id)), options };
    cache = { data, at: Date.now() };
    return data;
  } catch (err) {
    console.error("[fudo] No se pudo leer la disponibilidad:", err instanceof Error ? err.message : err);
    return cache?.data ?? null;
  }
}
