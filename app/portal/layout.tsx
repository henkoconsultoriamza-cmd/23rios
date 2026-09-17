import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Casa Numa · Portal gastronómico",
  description: "Menú, reservas, eventos y experiencias de Casa Numa en un único punto de encuentro digital.",
  openGraph: {
    type: "website",
    title: "Casa Numa · Portal gastronómico",
    description: "Menú, reservas, eventos y experiencias de Casa Numa en un único punto de encuentro digital.",
    images: [{ url: "/og.png", width: 1728, height: 918, alt: "Casa Numa · Portal gastronómico" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Casa Numa · Portal gastronómico",
    description: "Menú, reservas, eventos y experiencias de Casa Numa en un único punto de encuentro digital.",
    images: ["/og.png"],
  },
};

export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
