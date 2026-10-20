/**
 * POST /api/admin/products — guarda un producto a la vez sobre la versión más reciente.
 *   { op: "create", product }           → agrega un producto nuevo
 *   { op: "patch", id, fields }         → aplica solo los campos cambiados
 *   { op: "delete", id }                → lo borra y lo saca de los relacionados
 * Responde { products, product? } con la lista ya guardada.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { applyFields, readConfig, writeConfig } from "@/lib/restaurant-config";
import type { Product } from "@/app/menu-data";

type Body =
  | { op: "create"; product: Product }
  | { op: "patch"; id: string; fields: Record<string, unknown> }
  | { op: "delete"; id: string };

export async function POST(req: NextRequest) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || !("op" in body)) {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }

  try {
    const products = (await readConfig<Product[]>("products")) ?? [];
    let next: Product[];
    let product: Product | undefined;

    if (body.op === "create") {
      const base = body.product.id || "producto";
      let id = base;
      for (let n = 2; products.some((p) => p.id === id); n++) id = `${base}-${n}`;
      product = { ...body.product, id };
      next = [product, ...products];
    } else if (body.op === "patch") {
      const current = products.find((p) => p.id === body.id);
      if (!current) {
        return NextResponse.json({ error: "Ese producto ya no existe: lo borraron desde otra pestaña." }, { status: 404 });
      }
      product = applyFields(current, body.fields ?? {});
      next = products.map((p) => (p.id === body.id ? product! : p));
    } else if (body.op === "delete") {
      next = products
        .filter((p) => p.id !== body.id)
        .map((p) => ({ ...p, relatedIds: (p.relatedIds ?? []).filter((r) => r !== body.id) }));
    } else {
      return NextResponse.json({ error: "Operación desconocida" }, { status: 400 });
    }

    await writeConfig("products", next);
    return NextResponse.json({ products: next, product });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
