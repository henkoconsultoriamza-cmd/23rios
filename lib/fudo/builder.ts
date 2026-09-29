// Funciones puras que arman los bodies JSON exactos que Fudo espera.
// Sin I/O, sin efectos secundarios — fácil de testear.

import type {
  CreateSaleBody,
  CreateItemBody,
  OrderLineInput,
} from "./types";

/**
 * Arma el body para abrir una cuenta en Fudo.
 * @param fudoTableId  ID interno de Fudo para la mesa (obtenido de GET /tables)
 * @param people       Cantidad de personas en la mesa
 */
export function buildCreateSale(
  fudoTableId: string,
  people: number
): CreateSaleBody {
  return {
    data: {
      type: "Sale",
      attributes: {
        saleType: "EAT-IN",
        people,
      },
      relationships: {
        table: {
          data: { type: "Table", id: fudoTableId },
        },
      },
    },
  };
}

/**
 * Arma el body para agregar un ítem a una venta abierta en Fudo.
 * Los ingredientes removidos se convierten en un comment legible.
 */
export function buildCreateItem(
  saleId: string,
  line: OrderLineInput
): CreateItemBody {
  const comment = buildComment(line.removals);
  return {
    data: {
      type: "Item",
      attributes: {
        quantity: line.quantity,
        price: line.unitPrice,
        ...(comment ? { comment } : {}),
      },
      relationships: {
        product: { data: { type: "Product", id: line.fudoProductId } },
        sale: { data: { type: "Sale", id: saleId } },
      },
    },
  };
}

/**
 * Convierte la lista de ingredientes removidos en un string para el comment del ítem.
 * Ej: ["cebolla", "tomate"] → "Sin cebolla, sin tomate"
 */
export function buildComment(removals: string[]): string {
  if (removals.length === 0) return "";
  return removals.map((r) => `Sin ${r}`).join(", ");
}

/**
 * Construye todos los CreateItemBody de una tanda de pedido.
 * Un ítem por línea (no agrupa cantidades — Fudo las acepta individualmente
 * o como quantity > 1, ambas formas son equivalentes).
 */
export function buildOrderItems(
  saleId: string,
  lines: OrderLineInput[]
): CreateItemBody[] {
  return lines.map((line) => buildCreateItem(saleId, line));
}
