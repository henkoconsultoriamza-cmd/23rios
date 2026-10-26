/**
 * POST /api/admin/qr { destino } — guarda adónde redirige /qr (el QR de las mesas).
 * Vacío = vuelve al menú.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { writeConfig } from "@/lib/restaurant-config";
import { QR_DESTINATION_KEY, isValidQrDestination } from "@/lib/qr-destination";

export async function POST(req: NextRequest) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { destino?: unknown } | null;
  const destino = typeof body?.destino === "string" ? body.destino.trim() : null;
  if (destino === null) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  if (destino && !isValidQrDestination(destino)) {
    return NextResponse.json({ error: "El destino tiene que ser una dirección que empiece con https:// (y no puede ser /qr)." }, { status: 400 });
  }
  try {
    await writeConfig(QR_DESTINATION_KEY, destino);
    return NextResponse.json({ destino });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
