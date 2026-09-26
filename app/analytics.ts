import { insertAnalyticsEvent, fetchAnalyticsEvents, clearAnalyticsEvents as clearFromDb } from "../db/config";

export type EventType =
  | "session_start"
  | "product_view"
  | "crosssell_click"
  | "filter_use"
  | "category_switch"
  | "cart_add"
  | "cart_send"
  | "language_change"
  | "events_open"
  | "banner_click"
  | "banner_view"
  | "assistant_open"
  | "bill_request";

export type AnalyticsEvent = {
  id: string;
  type: EventType;
  sessionId: string;
  timestamp: string;
  productId?: string;
  relatedProductId?: string;
  language?: string;
  bannerId?: string;
  filterName?: string;
  filterType?: string;
};

const SESSION_ID_KEY = "restaurant-analytics-session-id-v1";

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.sessionStorage.getItem(SESSION_ID_KEY);
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    window.sessionStorage.setItem(SESSION_ID_KEY, id);
  }
  return id;
}

export function trackEvent(
  type: EventType,
  data?: Partial<Omit<AnalyticsEvent, "id" | "type" | "sessionId" | "timestamp">>,
): void {
  if (typeof window === "undefined") return;
  const event: AnalyticsEvent = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    type,
    sessionId: getOrCreateSessionId(),
    timestamp: new Date().toISOString(),
    ...data,
  };
  // Fire and forget — no bloquea la UI
  insertAnalyticsEvent(event).catch(() => undefined);
}

export async function getStoredEvents(): Promise<AnalyticsEvent[]> {
  return fetchAnalyticsEvents();
}

export async function clearStoredEvents(): Promise<void> {
  return clearFromDb();
}
