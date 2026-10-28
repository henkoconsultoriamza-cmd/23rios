/**
 * GET /api/fudo-disponibles → { ids, options }: IDs de FUDO que hoy se pueden pedir y,
 * para los productos con opciones (combos, promos), qué opciones acepta FUDO en cada uno.
 * La carta oculta lo que no esté acá. ids = null si FUDO no respondió (no se oculta nada).
 */
import { NextResponse } from "next/server";
import { getFudoAvailability } from "@/lib/fudo/availability";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getFudoAvailability();
  return NextResponse.json(
    data ?? { ids: null, options: {} },
    // La CDN lo guarda un minuto: muchos clientes a la vez no le pegan a FUDO cada uno
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
