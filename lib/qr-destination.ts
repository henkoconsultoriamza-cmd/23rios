/**
 * Destino del QR de las mesas. El QR impreso apunta siempre a /qr y /qr redirige
 * a lo que esté guardado en restaurant_config.qr_destino (se edita en Ajustes del admin).
 * Vacío = el menú.
 */
export const QR_DESTINATION_KEY = "qr_destino";

/** Una dirección http(s) que no vuelva a /qr (eso haría un bucle). */
export function isValidQrDestination(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return url.pathname.replace(/\/+$/, "") !== "/qr";
  } catch {
    return false;
  }
}
