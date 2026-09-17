import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "23 Ríos · Carta Digital";
const description =
  "Explorá las cervezas artesanales y la cocina de 23 Ríos. Encontrá tu combinación perfecta y pedí desde la mesa.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const baseUrl = host ? new URL(`${protocol}://${host}`) : undefined;

  return {
    metadataBase: baseUrl,
    title,
    description,
    manifest: "/manifest.webmanifest",
    openGraph: {
      type: "website",
      title,
      description,
      images: [{ url: "/og.png", width: 1728, height: 918, alt: "23 Ríos · Carta Digital" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export const viewport: Viewport = { themeColor: "#0d0f0e", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
