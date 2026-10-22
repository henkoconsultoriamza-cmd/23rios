/**
 * POST /api/fudo-worker — manda a FUDO los pedidos pendientes de los últimos minutos.
 *
 * Los pedidos salen solos al lanzarlos (/api/orders). Esta ruta es la red de seguridad:
 * la llama una tarea programada de Supabase (pg_cron) cada minuto para reintentar lo que
 * haya quedado pendiente. Llamarla de más no hace daño: cada pedido se reserva antes de
 * enviarse y lo viejo no se manda.
 */
import { NextResponse } from "next/server";
import { processOutbox } from "@/lib/fudo/send-order";

export const maxDuration = 60;

export async function POST() {
  try {
    return NextResponse.json(await processOutbox());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
