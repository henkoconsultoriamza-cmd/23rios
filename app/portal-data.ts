export type PortalActionStyle = "featured" | "card" | "compact";

export type PortalAction = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: "menu" | "calendar" | "pin" | "wine" | "cocktail" | "whatsapp" | "instagram" | "link";
  style: PortalActionStyle;
  visible: boolean;
};

export type PortalSettings = {
  eyebrow: string;
  title: string;
  highlight: string;
  description: string;
  statusLabel: string;
  statusDetail: string;
  address: string;
  hours: string;
  coverImageUrl: string;
  showStatus: boolean;
  showAddress: boolean;
  showHours: boolean;
  actions: PortalAction[];
};

export const PORTAL_SETTINGS_STORAGE_KEY = "restaurant-template-portal-settings-v1";

export const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
  eyebrow: "23 RÍOS · CERVECERÍA ARTESANAL",
  title: "Cerveza hecha acá,",
  highlight: "tomada acá.",
  description: "Explorá nuestras cervezas artesanales, pedí tu lugar y enteráte de los eventos que preparamos.",
  statusLabel: "Abierto ahora",
  statusDetail: "Cocina hasta las 00:30",
  address: "Mendoza, Argentina",
  hours: "Martes a domingos · 20:00 a 00:30",
  coverImageUrl: "/images/23rios/canillas.png",
  showStatus: true,
  showAddress: true,
  showHours: true,
  actions: [
    { id: "menu", label: "Explorar el menú", description: "Cervezas, cocina, precios y recomendaciones", href: "/#carta", icon: "menu", style: "featured", visible: true },
    { id: "reserve", label: "Reservar una mesa", description: "Coordiná tu visita por WhatsApp", href: "https://wa.me/5492610000000?text=Hola%2C%20quisiera%20reservar%20una%20mesa%20en%2023%20R%C3%ADos", icon: "calendar", style: "card", visible: true },
    { id: "events", label: "Próximos eventos", description: "Festivales, lanzamientos y noches de cerveza", href: "/#eventos", icon: "calendar", style: "card", visible: true },
    { id: "location", label: "Cómo llegar", description: "Abrir ubicación en Google Maps", href: "https://www.google.com/maps/search/?api=1&query=23+R%C3%ADos+Mendoza", icon: "pin", style: "card", visible: true },
    { id: "cervezas", label: "Cervezas artesanales", description: "Rubias, rojas y negras de fábrica", href: "/?grupo=Cerveza#carta", icon: "wine", style: "compact", visible: true },
    { id: "instagram", label: "Instagram", description: "Novedades y vida de cervecería", href: "https://www.instagram.com/", icon: "instagram", style: "compact", visible: true },
  ],
};

export function cloneDefaultPortalSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_PORTAL_SETTINGS)) as PortalSettings;
}
