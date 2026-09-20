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
    id: "cerveza-salvaja",
    title: "Salvaja · Orange Wheat",
    subtitle: "Una nueva pinta llega a 23 Ríos.",
    imageUrl: "/images/23rios/banner-salvaja.png",
    ctaLabel: "Ver en carta",
    ctaHref: "/#cervezas",
    visible: true,
  },
];

export function cloneDefaultBanners(): Banner[] {
  return JSON.parse(JSON.stringify(DEFAULT_BANNERS)) as Banner[];
}
