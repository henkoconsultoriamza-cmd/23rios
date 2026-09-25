export type EventItem = {
  id: string;
  title: string;
  subtitle?: string;
  date?: string;      // "2026-10-15"
  time?: string;      // "20:00"
  imageUrl?: string;
  ctaLabel?: string;
  ctaHref?: string;
  active: boolean;
};

export const EVENTS_STORAGE_KEY = "restaurant-template-events-v1";
