/**
 * Alinea el menú con el catálogo del menú QR de FUDO: precio e ID de categoría de cada
 * producto vinculado y, en las promociones, sus opciones para elegir. Los productos que en
 * FUDO están en una categoría de promociones pasan a la categoría «Promociones» del menú.
 * No toca nombres, fotos, descripciones ni la programación.
 * Función pura: no lee ni escribe nada, devuelve la lista nueva y el detalle.
 */
import type { Product } from "../../app/menu-data";
import type { FudoCatalogItem } from "./qr-catalog";

export type FudoSyncReport = {
  /** «Picada de fiambres: precio $17.500 → $10.800» */
  changes: string[];
  /** Vinculados a un ID que no está en el menú QR de FUDO: esos pedidos fallan */
  missing: string[];
  /** Sin ID de FUDO: no llegan a cocina */
  unmapped: string[];
  /** Cosas para revisar a mano */
  warnings: string[];
};

const money = (n: number) => `$${Number(n || 0).toLocaleString("es-AR")}`;

/** Opciones del primer grupo de FUDO en el formato del menú (el menú maneja un grupo por producto). */
export function fudoOptionsFor(item: FudoCatalogItem): Partial<NonNullable<Product["fudoData"]>> {
  const group = item.groups[0];
  if (!group) return { modifierGroupId: undefined, modifierOptions: undefined, modifierMin: undefined, modifierMax: undefined };
  return {
    modifierGroupId: group.id,
    modifierOptions: group.options.map((o) => ({ name: o.name, fudoProductId: o.id })),
    modifierMin: group.min,
    modifierMax: group.max,
  };
}

export function syncWithFudo(
  products: Product[],
  catalog: FudoCatalogItem[],
): { products: Product[]; report: FudoSyncReport } {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const report: FudoSyncReport = { changes: [], missing: [], unmapped: [], warnings: [] };

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

      // Promociones: la categoría del menú y las opciones salen de FUDO
      if (item.promo && product.category !== "Promociones") {
        report.changes.push(`${product.name}: pasa a Promociones (en FUDO está en «${item.categoryName}»)`);
        next.category = "Promociones";
        next.group = "Promociones";
      } else if (!item.promo && product.category === "Promociones") {
        report.warnings.push(`${product.name}: está en Promociones pero en FUDO ya no está en una categoría de promociones («${item.categoryName}»). Cambiale la categoría.`);
      }
      if (item.promo) {
        const options = fudoOptionsFor(item);
        const current = { modifierGroupId: fudo?.modifierGroupId, modifierOptions: fudo?.modifierOptions, modifierMin: fudo?.modifierMin, modifierMax: fudo?.modifierMax };
        if (JSON.stringify(current) !== JSON.stringify(options)) {
          report.changes.push(`${product.name}: opciones actualizadas desde FUDO${item.groups[0] ? ` («${item.groups[0].name}», ${item.groups[0].min} a ${item.groups[0].max})` : " (sin opciones)"}`);
          next.fudoData = { ...next.fudoData, ...options };
        }
        if (item.groups.length > 1) {
          report.warnings.push(`${product.name}: en FUDO tiene ${item.groups.length} grupos de opciones y el menú usa solo el primero («${item.groups[0].name}»).`);
        }
      }
    }

    if (categoryId !== undefined && fudo?.categoryId !== categoryId) {
      report.changes.push(`${product.name}: categoría ${fudo?.categoryId ?? "—"} → ${categoryId}`);
      next.fudoData = { ...next.fudoData, categoryId };
    }
    return next;
  });

  return { products: nextProducts, report };
}

/** IDs de FUDO que el menú ya usa: productos, tamaños y opciones de combos y promociones. */
export function linkedFudoIds(products: Product[]): Set<string> {
  const ids = new Set<string>();
  for (const p of products) {
    if (p.fudoData?.productId) ids.add(String(p.fudoData.productId));
    for (const id of Object.values(p.fudoData?.servingIds ?? {})) if (id) ids.add(String(id));
    for (const o of p.fudoData?.modifierOptions ?? []) if (o.fudoProductId) ids.add(String(o.fudoProductId));
  }
  return ids;
}
