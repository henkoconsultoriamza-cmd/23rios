import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_COOKIE = "admin-session-v1";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Proteger /admin — verificar cookie server-side
  if (pathname.startsWith("/admin")) {
    const session = req.cookies.get(ADMIN_COOKIE);
    if (!session || session.value !== "authenticated") {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/admin/login";
      // Si ya está en /admin/login no redirigir para evitar loop
      if (pathname === "/admin/login") return NextResponse.next();
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
