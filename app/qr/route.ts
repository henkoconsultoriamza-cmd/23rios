/**
 * GET /qr — la dirección que va impresa en el QR de las mesas.
 * Redirige al destino guardado en Ajustes del admin, así se cambia adónde lleva
 * el QR sin reimprimirlo. Sin destino guardado (o si falla la base), va al menú.
 */
import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/restaurant-config";
import { QR_DESTINATION_KEY, isValidQrDestination } from "@/lib/qr-destination";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let destination = new URL("/", req.url).toString();
  try {
    const saved = await readConfig<string>(QR_DESTINATION_KEY);
    if (saved && isValidQrDestination(saved)) destination = saved;
  } catch {
    // Sin base: al menú, para que el QR nunca quede roto
  }
  // 307 y sin caché: con un 301 el teléfono recordaría el destino viejo
  return NextResponse.redirect(destination, { status: 307, headers: { "Cache-Control": "no-store" } });
}
