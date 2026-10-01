import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_COOKIE = "admin-session-v1";
// Solo verifica que la cookie tenga formato UUID válido.
// La verificación real contra DB ocurre en /api/admin-auth/check y en cada API route protegida.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin")) {
    // El login está integrado en /admin — no hay página /admin/login separada.
    // El middleware solo deja pasar; la página maneja el estado no autenticado.
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
