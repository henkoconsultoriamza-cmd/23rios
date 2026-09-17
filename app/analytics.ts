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

export const ANALYTICS_STORAGE_KEY = "restaurant-analytics-v1";
const SESSION_ID_KEY = "restaurant-analytics-session-id-v1";
const MAX_EVENTS = 1000;

function getOrCreateSessionId(): string {
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
  try {
    const raw = window.localStorage.getItem(ANALYTICS_STORAGE_KEY);
    const events: AnalyticsEvent[] = raw ? (JSON.parse(raw) as AnalyticsEvent[]) : [];
    events.push(event);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    window.localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(events));
  } catch { /* ignore */ }
}

export function getStoredEvents(): AnalyticsEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ANALYTICS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AnalyticsEvent[]) : [];
  } catch { return []; }
}

export function clearStoredEvents(): void {
  window.localStorage.removeItem(ANALYTICS_STORAGE_KEY);
}
