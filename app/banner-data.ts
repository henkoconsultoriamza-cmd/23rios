export type Banner = {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  ctaLabel: string;
  ctaHref: string;
  visible: boolean;
};

export const BANNERS_STORAGE_KEY = "restaurant-template-banners-v1";

export const DEFAULT_BANNERS: Banner[] = [
  {
    id: "cerveza-nueva-seasonal",
    title: "Nueva Seasonal · Edición limitada",
    subtitle: "Tropical, cítrica y refrescante. Disponible esta semana.",
    imageUrl: "/images/23rios/banner-cerveza-nueva.svg",
    ctaLabel: "Ver en carta",
    ctaHref: "/#cervezas",
    visible: true,
  },
];

export function cloneDefaultBanners(): Banner[] {
  return JSON.parse(JSON.stringify(DEFAULT_BANNERS)) as Banner[];
}
