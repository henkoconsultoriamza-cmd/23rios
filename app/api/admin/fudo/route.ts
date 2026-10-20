/**
 * GET  /api/admin/fudo → { catalog }: productos del menú QR de FUDO (ID, nombre, precio, categoría).
 * POST /api/admin/fudo → actualiza precio e ID de categoría de todo el menú desde FUDO.
 *      Responde { products, promos, catalog, report }.
 */
import { NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { getFudoQrCatalog } from "@/lib/fudo/qr-catalog";
import { syncWithFudo } from "@/lib/fudo/sync";
import { readConfig, writeConfig } from "@/lib/restaurant-config";
import type { Product, Promo } from "@/app/menu-data";

const unauthorized = () => NextResponse.json({ error: "No autorizado" }, { status: 401 });
const failed = (err: unknown) =>
  NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });

export async function GET() {
  if (!(await verifyAdminSession())) return unauthorized();
  try {
    return NextResponse.json({ catalog: await getFudoQrCatalog() });
  } catch (err) {
    return failed(err);
  }
}

export async function POST() {
  if (!(await verifyAdminSession())) return unauthorized();
  try {
    // Primero FUDO y después la base, para que la lectura y la escritura queden lo más juntas posible
    const catalog = await getFudoQrCatalog();
    if (!catalog.length) throw new Error("FUDO devolvió el catálogo vacío: no se actualizó nada.");
    const [products, promos] = await Promise.all([
      readConfig<Product[]>("products").then((v) => v ?? []),
      readConfig<Promo[]>("promos").then((v) => v ?? []),
    ]);
    const result = syncWithFudo(products, promos, catalog);

    if (JSON.stringify(result.products) !== JSON.stringify(products)) await writeConfig("products", result.products);
    if (JSON.stringify(result.promos) !== JSON.stringify(promos)) await writeConfig("promos", result.promos);

    return NextResponse.json({ products: result.products, promos: result.promos, catalog, report: result.report });
  } catch (err) {
    return failed(err);
  }
}
