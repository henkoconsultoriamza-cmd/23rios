/**
 * Alinea el menú con el catálogo del menú QR de FUDO: precio e ID de categoría
 * de cada producto vinculado. No toca nombres, fotos ni descripciones.
 * Función pura: no lee ni escribe nada, devuelve las listas nuevas y el detalle.
 */
import type { Product, Promo } from "../../app/menu-data";
import type { FudoCatalogItem } from "./qr-catalog";

export type FudoSyncReport = {
  /** «Picada de fiambres: precio $17.500 → $10.800» */
  changes: string[];
  /** Vinculados a un ID que no está en el menú QR de FUDO: esos pedidos fallan */
  missing: string[];
  /** Sin ID de FUDO: no llegan a cocina */
  unmapped: string[];
};

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-AR")}`;

export function syncWithFudo(
  products: Product[],
  promos: Promo[],
  catalog: FudoCatalogItem[],
): { products: Product[]; promos: Promo[]; report: FudoSyncReport } {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const report: FudoSyncReport = { changes: [], missing: [], unmapped: [] };

  const nextProducts = products.map((product) => {
    const fudo = product.fudoData;
    const servingIds = fudo?.servingIds ?? {};
    const hasServings = !!product.servings?.length && Object.keys(servingIds).length > 0;
    if (!hasServings && !fudo?.productId) {
      report.unmapped.push(product.name);
      return product;
    }

    const next: Product = structuredClone(product);
    let categoryId: number | undefined;

    if (hasServings) {
      next.servings = next.servings!.map((serving) => {
        const id = servingIds[serving.label];
        if (!id) {
          report.unmapped.push(`${product.name} · ${serving.label}`);
          return serving;
        }
        const item = byId.get(String(id));
        if (!item) {
          report.missing.push(`${product.name} · ${serving.label} (ID ${id})`);
          return serving;
        }
        categoryId ??= item.categoryId;
        if (serving.price !== item.price) {
          report.changes.push(`${product.name} · ${serving.label}: precio ${money(serving.price)} → ${money(item.price)}`);
          return { ...serving, price: item.price };
        }
        return serving;
      });
    } else {
      const item = byId.get(String(fudo!.productId));
      if (!item) {
        report.missing.push(`${product.name} (ID ${fudo!.productId})`);
        return product;
      }
      categoryId = item.categoryId;
      if (product.price !== item.price) {
        report.changes.push(`${product.name}: precio ${money(product.price)} → ${money(item.price)}`);
        next.price = item.price;
      }
    }

    if (categoryId !== undefined && fudo?.categoryId !== categoryId) {
      report.changes.push(`${product.name}: categoría ${fudo?.categoryId ?? "—"} → ${categoryId}`);
      next.fudoData = { ...next.fudoData, categoryId };
    }
    return next;
  });

  const nextPromos = promos.map((promo) => {
    if (promo.type !== "happy-hour" || !promo.happyHourFudoProductId) return promo;
    const title = promo.happyHourTitle ?? "Happy Hour";
    const item = byId.get(String(promo.happyHourFudoProductId));
    if (!item) {
      report.missing.push(`Promo «${title}» (ID ${promo.happyHourFudoProductId})`);
      return promo;
    }
    const next = { ...promo };
    if (promo.happyHourPrice !== item.price) {
      report.changes.push(`Promo «${title}»: precio ${money(promo.happyHourPrice ?? 0)} → ${money(item.price)}`);
      next.happyHourPrice = item.price;
    }
    if (promo.happyHourFudoCategoryId !== item.categoryId) {
      report.changes.push(`Promo «${title}»: categoría ${promo.happyHourFudoCategoryId ?? "—"} → ${item.categoryId}`);
      next.happyHourFudoCategoryId = item.categoryId;
    }
    return next;
  });

  return { products: nextProducts, promos: nextPromos, report };
}

/** IDs de FUDO que el menú ya usa: productos, tamaños, opciones de combos y happy hour. */
export function linkedFudoIds(products: Product[], promos: Promo[]): Set<string> {
  const ids = new Set<string>();
  for (const p of products) {
    if (p.fudoData?.productId) ids.add(String(p.fudoData.productId));
    for (const id of Object.values(p.fudoData?.servingIds ?? {})) if (id) ids.add(String(id));
    for (const o of p.fudoData?.modifierOptions ?? []) if (o.fudoProductId) ids.add(String(o.fudoProductId));
  }
  for (const promo of promos) {
    if (promo.happyHourFudoProductId) ids.add(String(promo.happyHourFudoProductId));
    for (const o of promo.happyHourOptions ?? []) if (o.fudoProductId) ids.add(String(o.fudoProductId));
  }
  return ids;
}
