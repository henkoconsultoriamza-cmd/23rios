/**
 * Catálogo del menú QR de FUDO: la misma lista que carga menu.fu.do/23rios/self-service.
 *
 * Es la fuente de verdad de los IDs de producto, de categoría y de los precios.
 * Son los IDs internos de FUDO (los mismos de api.fu.do), no el «código» (PLT-013, 150…).
 *
 * Endpoint no oficial, igual que el de pedidos: ver README.md.
 */

const FUDO_QR_BASE = "https://integrations.fu.do/fudo";
const FUDO_ACCOUNT_SLUG = "23rios";
const FUDO_ACCOUNT_ID = process.env.FUDO_ACCOUNT_ID ?? "MjNyaW9z"; // base64 de "23rios"

/**
 * Categorías de FUDO que son promociones: «120 Promociones» (60) con todas sus
 * subcategorías, y «10 Cerveza › Happy Hour» (78). Solo esos productos se pueden
 * programar por día y horario en el menú.
 */
const PROMO_CATEGORY_ROOTS = new Set([60, 78]);
// Subcategorías de 120 conocidas (el menú QR no publica la 120, así que no trae sus hijas)
const KNOWN_PROMO_SUBCATEGORIES = new Set([109, 110, 111]);

type QrGroup = {
  id: number;
  name: string;
  minQuantity: number;
  maxQuantity: number;
  productGroupProducts: { productId: number; price: number }[];
};

type QrProduct = {
  id: number;
  name: string;
  price: number;
  productCategoryId: number;
  isAvailable: boolean;
  position: number;
  productGroups?: QrGroup[];
};

type QrCategory = { id: number; name: string; parentId: number | null; position: number };

/** Opciones para elegir dentro de un producto (ej. «Elija cerveza clásica», 2 de 5) */
export type FudoOptionGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  options: { id: string; name: string; price: number }[];
};

export type FudoCatalogItem = {
  id: string;
  name: string;
  price: number;
  categoryId: number;
  /** "10 Cerveza › Golden" */
  categoryName: string;
  available: boolean;
  /** Está en una categoría de promociones de FUDO */
  promo: boolean;
  groups: FudoOptionGroup[];
};

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim();

async function getQr<T>(path: string): Promise<T> {
  const res = await fetch(`${FUDO_QR_BASE}/${path}/?a=${FUDO_ACCOUNT_SLUG}`, {
    headers: { "fudo-app": "self-service", "fudo-account-id": FUDO_ACCOUNT_ID },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FUDO ${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// Categorías que el menú QR no publica: se consultan en la API oficial, si hay credenciales.
const officialCategories = new Map<number, QrCategory | null>();

async function loadUnpublishedCategories(ids: number[]) {
  const missing = ids.filter((id) => !officialCategories.has(id));
  if (!missing.length || !process.env.FUDO_API_KEY || !process.env.FUDO_API_SECRET) return;
  try {
    const auth = await fetch(process.env.FUDO_AUTH_URL ?? "https://auth.fu.do/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: process.env.FUDO_API_KEY, apiSecret: process.env.FUDO_API_SECRET }),
      cache: "no-store",
    }).then((r) => r.json());
    const token = auth.token ?? auth.access_token;
    if (!token) return;
    const base = process.env.FUDO_BASE_URL ?? "https://api.fu.do/v1alpha1";
    // Las padres también pueden faltar (ej. 109 → 60), así que se sube por la cadena
    let queue = missing;
    for (let depth = 0; queue.length && depth < 3; depth++) {
      const parents: number[] = [];
      await Promise.all(queue.map(async (id) => {
        const json = await fetch(`${base}/product-categories/${id}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          cache: "no-store",
        }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const data = json?.data;
        if (!data) { officialCategories.set(id, null); return; }
        const parentId = Number(data.relationships?.parentCategory?.data?.id) || null;
        officialCategories.set(id, { id, name: data.attributes?.name ?? `Categoría ${id}`, parentId, position: data.attributes?.position ?? Infinity });
        if (parentId && !officialCategories.has(parentId)) parents.push(parentId);
      }));
      queue = parents;
    }
  } catch {
    // Sin API oficial: quedan las categorías conocidas
  }
}

export async function getFudoQrCatalog(): Promise<FudoCatalogItem[]> {
  const [{ products }, { productCategories }] = await Promise.all([
    getQr<{ products: QrProduct[] }>("products"),
    getQr<{ productCategories: QrCategory[] }>("product-categories"),
  ]);
  const published = new Map(productCategories.map((c) => [c.id, c]));
  await loadUnpublishedCategories([...new Set(products.map((p) => p.productCategoryId))].filter((id) => !published.has(id)));
  const categoryOf = (id: number | null | undefined) => (id ? published.get(id) ?? officialCategories.get(id) ?? undefined : undefined);
  const productNames = new Map(products.map((p) => [p.id, cleanName(p.name)]));

  const isPromoCategory = (categoryId: number) => {
    if (PROMO_CATEGORY_ROOTS.has(categoryId) || KNOWN_PROMO_SUBCATEGORIES.has(categoryId)) return true;
    for (let c = categoryOf(categoryId), depth = 0; c && depth < 5; c = categoryOf(c.parentId), depth++) {
      if (PROMO_CATEGORY_ROOTS.has(c.id)) return true;
    }
    return false;
  };

  const pathOf = (categoryId: number) => {
    const c = categoryOf(categoryId);
    if (!c) return { name: `Categoría ${categoryId}`, order: [Infinity, Infinity] };
    const parent = categoryOf(c.parentId);
    return {
      name: parent ? `${parent.name} › ${c.name}` : c.name,
      order: parent ? [parent.position, c.position] : [c.position, -1],
    };
  };

  return products
    .map((p) => ({ p, path: pathOf(p.productCategoryId) }))
    .sort((a, b) =>
      a.path.order[0] - b.path.order[0] || a.path.order[1] - b.path.order[1] || a.p.position - b.p.position)
    .map(({ p, path }) => ({
      id: String(p.id),
      name: cleanName(p.name),
      price: p.price,
      categoryId: p.productCategoryId,
      categoryName: path.name,
      available: p.isAvailable,
      promo: isPromoCategory(p.productCategoryId),
      groups: (p.productGroups ?? []).map((g) => ({
        id: String(g.id),
        name: cleanName(g.name),
        min: g.minQuantity,
        max: g.maxQuantity,
        options: g.productGroupProducts.map((o) => ({
          id: String(o.productId),
          name: productNames.get(o.productId) ?? `Producto ${o.productId}`,
          price: o.price ?? 0,
        })),
      })),
    }));
}
