/**
 * Qué productos de FUDO se pueden pedir ahora: los que figuran en el menú QR de FUDO
 * y no están marcados como no disponibles. Si un pedido lleva un producto desactivado
 * o agotado en FUDO, FUDO rechaza el pedido entero (notAvailable): por eso la carta
 * no los muestra y los saca del carrito antes de lanzar.
 */
const FUDO_PRODUCTS_URL = "https://integrations.fu.do/fudo/products/?a=23rios";
const FUDO_ACCOUNT_ID = process.env.FUDO_ACCOUNT_ID ?? "MjNyaW9z"; // base64 de "23rios"
const TTL_MS = 60_000;

let cache: { ids: Set<string>; at: number } | null = null;

/** IDs de FUDO disponibles, o null si no se pudo consultar (en ese caso no se oculta nada). */
export async function getFudoAvailableIds(): Promise<Set<string> | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  try {
    const res = await fetch(FUDO_PRODUCTS_URL, {
      headers: { "fudo-app": "self-service", "fudo-account-id": FUDO_ACCOUNT_ID },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { products } = (await res.json()) as { products?: { id: number; isAvailable?: boolean }[] };
    // Una lista vacía es un error de FUDO, no «nada disponible»: no se oculta la carta entera
    if (!Array.isArray(products) || products.length === 0) throw new Error("FUDO devolvió la lista vacía");
    cache = { ids: new Set(products.filter((p) => p.isAvailable !== false).map((p) => String(p.id))), at: Date.now() };
    return cache.ids;
  } catch (err) {
    console.error("[fudo] No se pudo leer la disponibilidad:", err instanceof Error ? err.message : err);
    return cache?.ids ?? null;
  }
}
