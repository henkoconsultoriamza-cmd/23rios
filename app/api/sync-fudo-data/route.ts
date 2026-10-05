/**
 * POST /api/sync-fudo-data
 * Toma los productos guardados en Supabase y les agrega el fudoData
 * definido en DEFAULT_PRODUCTS de menu-data.ts (que tiene los IDs de Fudo).
 * No pisa precios ni ningún otro campo — solo actualiza fudoData.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_PRODUCTS } from "@/app/menu-data";

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST() {
  const supabase = sb();

  // Leer productos actuales de Supabase
  const { data, error } = await supabase
    .from("restaurant_config")
    .select("value")
    .eq("key", "products")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "No se encontraron productos en Supabase" }, { status: 404 });
  }

  const currentProducts = data.value as Array<Record<string, unknown>>;

  // Construir índice de fudoData por id desde DEFAULT_PRODUCTS
  const fudoIndex = new Map(
    DEFAULT_PRODUCTS.map((p) => [p.id, p.fudoData]),
  );

  // Merge: mantener todo de Supabase, solo agregar/actualizar fudoData
  let updated = 0;
  const merged = currentProducts.map((product) => {
    const id = product.id as string;
    const fudoData = fudoIndex.get(id);
    if (fudoData) {
      updated++;
      return { ...product, fudoData };
    }
    return product;
  });

  // Guardar en Supabase
  const { error: saveError } = await supabase
    .from("restaurant_config")
    .update({ value: merged })
    .eq("key", "products");

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  return NextResponse.json({
    total: merged.length,
    updated,
    sinFudoData: merged.length - updated,
  });
}
