/**
 * GET /api/fudo-disponibles → { ids }: IDs de FUDO que hoy se pueden pedir.
 * La carta oculta lo que no esté acá. ids = null si FUDO no respondió (no se oculta nada).
 */
import { NextResponse } from "next/server";
import { getFudoAvailableIds } from "@/lib/fudo/availability";

export const dynamic = "force-dynamic";

export async function GET() {
  const ids = await getFudoAvailableIds();
  return NextResponse.json(
    { ids: ids ? [...ids] : null },
    // La CDN lo guarda un minuto: muchos clientes a la vez no le pegan a FUDO cada uno
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}
