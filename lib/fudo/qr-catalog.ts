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

type QrProduct = {
  id: number;
  name: string;
  price: number;
  productCategoryId: number;
  isAvailable: boolean;
  position: number;
};

type QrCategory = { id: number; name: string; parentId: number | null; position: number };

export type FudoCatalogItem = {
  id: string;
  name: string;
  price: number;
  categoryId: number;
  /** "10 Cerveza › Golden" */
  categoryName: string;
  available: boolean;
};

async function getQr<T>(path: string): Promise<T> {
  const res = await fetch(`${FUDO_QR_BASE}/${path}/?a=${FUDO_ACCOUNT_SLUG}`, {
    headers: { "fudo-app": "self-service", "fudo-account-id": FUDO_ACCOUNT_ID },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FUDO ${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function getFudoQrCatalog(): Promise<FudoCatalogItem[]> {
  const [{ products }, { productCategories }] = await Promise.all([
    getQr<{ products: QrProduct[] }>("products"),
    getQr<{ productCategories: QrCategory[] }>("product-categories"),
  ]);
  const categories = new Map(productCategories.map((c) => [c.id, c]));

  const pathOf = (categoryId: number) => {
    const c = categories.get(categoryId);
    if (!c) return { name: `Categoría ${categoryId}`, order: [Infinity, Infinity] };
    const parent = c.parentId ? categories.get(c.parentId) : undefined;
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
      name: p.name.replace(/\s+/g, " ").trim(),
      price: p.price,
      categoryId: p.productCategoryId,
      categoryName: path.name,
      available: p.isAvailable,
    }));
}
