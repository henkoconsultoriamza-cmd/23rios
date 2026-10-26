"use client";

import { CSSProperties, Dispatch, Fragment, FormEvent, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { Language, languageOptions, translate } from "./translations";
import { AppSettings, DEFAULT_APP_SETTINGS, DEFAULT_MENU_SETTINGS, DEFAULT_PRODUCTS, MenuSettings, Product, displayedPrice, mergeDefaultNutrition, offeredServings } from "./menu-data";
import { isScheduleActive } from "../lib/promo-schedule";
import { trackEvent } from "./analytics";
import { Banner, DEFAULT_BANNERS } from "./banner-data";
import { EventItem } from "./event-data";
import { getProducts, getMenuSettings, getAppSettings, getBanners, getEvents, subscribeToConfig } from "../db/config";

type Message = { id: number; role: "assistant" | "user"; text: string };
type OrderStatus = "idle" | "draft" | "sent";
type OrderItem = {
  key: string;
  productId: string;
  fudoProductId?: string;
  fudoCategoryId?: string;
  name: string;
  image?: string;
  serving?: string;
  volume?: string;
  unitPrice: number;
  quantity: number;
  removedIngredients?: string[];
  customNote?: string;
  modifiers?: Array<{ name: string; fudoProductId: string }>;
};
type LaunchedOrder = {
  id: string;
  launchedAt: string;
  items: OrderItem[];
  total: number;
  tableNumber: string;
  guestName?: string;
  guestPhone?: string;
  guestCount?: number;
  status: "En preparación" | "Cuenta solicitada" | "Cerrado";
};

const allergenIcons: Record<string, string> = {
  Gluten: "🌾",
  "Lácteos": "🥛",
  Huevo: "🥚",
};

const quickSuggestions = [
  { label: "¿Qué pido para comer?", answer: "El Smash 23 o el lomo clásico son los más pedidos. Si querés algo para compartir, la picada de fiambres no falla.", ids: ["smash-23", "lomo-clasico", "picada"] },
  { label: "Recomendame una cerveza", answer: "Si es la primera, arrancá con la Golden: dorada, suave y muy fácil. Si te gusta algo con más carácter, la Scottish es la mejor opción.", ids: ["golden", "scottish"] },
  { label: "Comida + cerveza", answer: "El lomo clásico con una pinta de Scottish es la combinación emblema de 23 Ríos. Malta y carne, una dupla perfecta.", ids: ["lomo-clasico", "scottish"] },
];

const events = [
  {
    id: "star-wars-fest",
    title: "Star Wars Fest · 23 Ríos",
    date: "Por confirmar",
    time: "20 hs",
    place: "23 Ríos",
    image: "/images/23rios/evento-star-wars-fest.jpg",
    admission: "Consultar disponibilidad",
    description: "Una noche temática con cervezas especiales, ambientación de la saga y menú de autor para los fans de la fuerza.",
    highlights: ["Cervezas especiales", "Ambientación temática", "Cupos limitados", "Menú de autor"],
  },
];

function Icon({ name, size = 20 }: { name: "search" | "spark" | "arrow" | "close" | "heart" | "expand" | "bell" | "receipt" | "plus" | "filter"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>;
  if (name === "spark") return <svg {...common}><path d="M12 2c.7 5.5 4.5 9.3 10 10-5.5.7-9.3 4.5-10 10-.7-5.5-4.5-9.3-10-10 5.5-.7 9.3-4.5 10-10Z"/></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14M14 7l5 5-5 5"/></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>;
  if (name === "expand") return <svg {...common}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>;
  if (name === "bell") return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>;
  if (name === "receipt") return <svg {...common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>;
  if (name === "filter") return <svg {...common}><path d="M3 6h18M7 12h10M11 18h2"/></svg>;
  return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
}

function formatPrice(value: number, currency: AppSettings["currency"]) {
  const symbol = currency === "USD" ? "US$" : currency === "BRL" ? "R$" : "$";
  return `${symbol} ${value.toLocaleString("es-AR")}`;
}

type MenuCategory = "Cocina" | "Cervezas" | "SinTACC" | "Promociones";
const MENU_CATEGORIES: MenuCategory[] = ["Cocina", "Cervezas", "SinTACC", "Promociones"];

// Qué productos entran en cada solapa de la carta (las promos, solo dentro de su horario)
function inCategory(product: Product, category: MenuCategory, now: Date) {
  if (category === "Promociones") return product.category === "Promociones" && isScheduleActive(product.schedule, now);
  if (product.category === "Promociones") return false;
  if (category === "SinTACC") return product.category === "Sin TACC" || product.attributes.includes("Sin TACC");
  if (category === "Cervezas") return product.category === "Cervezas" || product.category === "Bebidas";
  return product.category === "Cocina";
}

function formatOrderDate(value: string, language: Language) {
  const locales: Record<Language, string> = { es: "es-AR", pt: "pt-BR", en: "en-US", fr: "fr-FR", it: "it-IT", de: "de-DE" };
  return new Intl.DateTimeFormat(locales[language], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function BannerCard({ banner, tr }: { banner: Banner; tr: (k: string) => string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          trackEvent("banner_view", { bannerId: banner.id });
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [banner.id]);
  return (
    <a
      ref={ref}
      className="novedad-card"
      href={banner.ctaHref}
      onClick={() => trackEvent("banner_click", { bannerId: banner.id })}
    >
      {banner.imageUrl && (
        <picture>
          {banner.imageUrlMobile && <source media="(max-width: 760px)" srcSet={banner.imageUrlMobile}/>}
          <img src={banner.imageUrl} alt={banner.title} className="novedad-img" fetchPriority="high" loading="eager"/>
        </picture>
      )}
      <span className="novedad-cta-btn">{tr("La quiero →")}</span>
    </a>
  );
}

function EventCard({ ev }: { ev: import("./event-data").EventItem }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          trackEvent("event_view", { eventId: ev.id });
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ev.id]);

  return (
    <article ref={ref}>
      {ev.imageUrl && <div className="event-poster"><img src={ev.imageUrl} alt={ev.title}/></div>}
      <div className="event-information">
        <h3>{ev.title}</h3>
        {(ev.date || ev.time || ev.timeSlots?.length) && <p className="event-date-text">{ev.date}{(ev.date && (ev.timeSlots?.length || ev.time)) ? " · " : ""}{(ev.timeSlots?.filter(Boolean) ?? (ev.time ? [ev.time] : [])).join(" / ")}</p>}
        {ev.subtitle && <p className="event-description">{ev.subtitle}</p>}
        {ev.ctaLabel && (ev.ctaHref
          ? <a className="event-cta" href={ev.ctaHref} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("event_cta_click", { eventId: ev.id })}>{ev.ctaLabel}</a>
          : <span className="event-cta">{ev.ctaLabel}</span>
        )}
      </div>
    </article>
  );
}

function NovedadesSlider({ banners, tr }: { banners: Banner[]; tr: (k: string) => string }) {
  const [current, setCurrent] = useState(0);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (banners.length <= 1) return;
    const timer = setInterval(() => setCurrent(i => (i + 1) % banners.length), 5000);
    return () => clearInterval(timer);
  }, [banners.length]);

  function handleTouchStart(e: React.TouchEvent) { touchStartX.current = e.touches[0].clientX; }
  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) setCurrent(i => diff > 0 ? (i + 1) % banners.length : (i - 1 + banners.length) % banners.length);
    touchStartX.current = null;
  }

  return (
    <section className="novedades-slider" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="novedades-slider-track" style={{ transform: `translateX(-${current * 100}%)` }}>
        {banners.map((b) => <BannerCard key={b.id} banner={b} tr={tr} />)}
      </div>
      {banners.length > 1 && (
        <>
          <button className="novedades-slider-arrow novedades-slider-arrow-prev" onClick={() => setCurrent(i => (i - 1 + banners.length) % banners.length)} aria-label="Anterior">&#8249;</button>
          <button className="novedades-slider-arrow novedades-slider-arrow-next" onClick={() => setCurrent(i => (i + 1) % banners.length)} aria-label="Siguiente">&#8250;</button>
          <div className="novedades-slider-dots">
            {banners.map((_, i) => <button key={i} className={i === current ? "active" : ""} onClick={() => setCurrent(i)} aria-label={`Banner ${i + 1}`}/>)}
          </div>
        </>
      )}
    </section>
  );
}

function EventsBannerSlider({ events, brandName, onOpen, tr }: { events: EventItem[]; brandName: string; onOpen: () => void; tr: (k: string) => string }) {
  const [current, setCurrent] = useState(0);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (events.length <= 1) return;
    const timer = setInterval(() => setCurrent(i => (i + 1) % events.length), 4000);
    return () => clearInterval(timer);
  }, [events.length]);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) setCurrent(i => diff > 0 ? (i + 1) % events.length : (i - 1 + events.length) % events.length);
    touchStartX.current = null;
  }

  const ev = events[current];
  return (
    <section className="events-banner" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="events-banner-track" style={{ transform: `translateX(-${current * 100}%)` }}>
        {events.map((e) => (
          <div key={e.id} className="events-banner-poster">
            {e.imageUrl && <img src={e.imageUrl} alt={`Evento en ${brandName}`}/>}
          </div>
        ))}
      </div>
      {events.length > 1 && (
        <>
          <button className="events-banner-arrow events-banner-arrow-prev" onClick={() => setCurrent(i => (i - 1 + events.length) % events.length)} aria-label="Anterior">&#8249;</button>
          <button className="events-banner-arrow events-banner-arrow-next" onClick={() => setCurrent(i => (i + 1) % events.length)} aria-label="Siguiente">&#8250;</button>
          <div className="events-banner-dots">
            {events.map((_, i) => <button key={i} className={i === current ? "active" : ""} onClick={() => setCurrent(i)} aria-label={`Evento ${i + 1}`}/>)}
          </div>
        </>
      )}
      <button className="events-banner-cta" onClick={onOpen}>{tr("Ver eventos")} <Icon name="arrow" size={18}/></button>
    </section>
  );
}

export default function Home() {
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [productsReady, setProductsReady] = useState(false);
  const [menuSettings, setMenuSettings] = useState<MenuSettings>(DEFAULT_MENU_SETTINGS);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const { foodGroups, foodPreferences, allergenOptions, drinkGroups, beerStyles } = menuSettings;
  const [language, setLanguage] = useState<Language>("es");
  const [langOpen, setLangOpen] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [category, setCategory] = useState<MenuCategory>("Cocina");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedPreferences, setSelectedPreferences] = useState<string[]>([]);
  const [excludedAllergens, setExcludedAllergens] = useState<string[]>([]);
  const [selectedBeerStyles, setSelectedBeerStyles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [selectedServing, setSelectedServing] = useState("Pinta");
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]); // fudoProductIds elegidos
  const [addingAnotherUnit, setAddingAnotherUnit] = useState(false);
  const [orderFeedback, setOrderFeedback] = useState("");
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [orderStatus, setOrderStatus] = useState<OrderStatus>("idle");
  const [orderOpen, setOrderOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [orderHydrated, setOrderHydrated] = useState(false);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [launchedOrders, setLaunchedOrders] = useState<LaunchedOrder[]>([]);
  const [tableNumber, setTableNumber] = useState("");
  const [tableDraft, setTableDraft] = useState("");
  const [tablePromptOpen, setTablePromptOpen] = useState(false);
  const [guestNameDraft, setGuestNameDraft] = useState("");
  const [guestPhoneDraft, setGuestPhoneDraft] = useState("");
  const [guestCountDraft, setGuestCountDraft] = useState("");
  const [billRequested, setBillRequested] = useState(false);
  const [customizeItemKey, setCustomizeItemKey] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  // Hora actual para las promociones programadas: se refresca cada minuto
  const [now, setNow] = useState(() => new Date());
  const [events, setEvents] = useState<EventItem[]>([]);
  const [urlToken] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("t") ?? "";
  });
  const [message, setMessage] = useState("");
  const [recommended, setRecommended] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: "assistant", text: "¡Hola! Soy el mozo digital de 23 Ríos. Puedo ayudarte a elegir una cerveza, revisar alérgenos o encontrar la combinación perfecta de comida y bebida." },
  ]);

  useEffect(() => {
    // Cargar preferencias del dispositivo (idioma, favoritos, pedido en curso)
    const savedFavorites = window.localStorage.getItem("restaurant-template-favorites");
    if (savedFavorites) {
      try { setFavorites(JSON.parse(savedFavorites)); } catch { window.localStorage.removeItem("restaurant-template-favorites"); }
    }
    const savedOrder = window.localStorage.getItem("restaurant-template-current-order-v2");
    if (savedOrder) {
      try {
        const parsed = JSON.parse(savedOrder) as { items?: OrderItem[]; status?: OrderStatus; activeOrderId?: string | null; tableNumber?: string; billRequested?: boolean };
        if (Array.isArray(parsed.items)) setOrderItems(parsed.items);
        if (parsed.status === "draft" || parsed.status === "sent") setOrderStatus(parsed.status);
        if (typeof parsed.activeOrderId === "string") setActiveOrderId(parsed.activeOrderId);
        if (typeof parsed.tableNumber === "string") setTableNumber(parsed.tableNumber);
        if (typeof parsed.billRequested === "boolean") setBillRequested(parsed.billRequested);
      } catch { window.localStorage.removeItem("restaurant-template-current-order-v2"); }
    }

    // Banners: caché local instantáneo + fetch desde edge cache de Vercel
    const cachedBanners = window.localStorage.getItem("cache-banners-v1");
    if (cachedBanners) { try { setBanners(JSON.parse(cachedBanners)); } catch { /* ignore */ } }
    fetch("/api/banners").then((r) => r.json()).then((bans) => {
      setBanners(bans ?? []);
      window.localStorage.setItem("cache-banners-v1", JSON.stringify(bans ?? []));
    }).catch(() => getBanners().then((bans) => setBanners(bans ?? [])));

    // Eventos: misma estrategia
    const cachedEvents = window.localStorage.getItem("cache-events-v1");
    if (cachedEvents) { try { setEvents(JSON.parse(cachedEvents)); } catch { /* ignore */ } }
    getEvents().then((evts) => {
      if (evts) { setEvents(evts); window.localStorage.setItem("cache-events-v1", JSON.stringify(evts)); }
    });

    // Resto de datos en paralelo
    Promise.all([
      getProducts(),
      getMenuSettings(),
      getAppSettings(),
    ]).then(([products, menuSetts, appSetts]) => {
      if (products) { setCatalogProducts(mergeDefaultNutrition(products)); setProductsReady(true); } else { setCatalogProducts(DEFAULT_PRODUCTS); setProductsReady(true); }
      if (menuSetts) setMenuSettings(menuSetts);
      if (appSetts) {
        const merged = { ...DEFAULT_APP_SETTINGS, ...appSetts };
        setAppSettings(merged);
        const savedLanguage = window.localStorage.getItem("restaurant-template-language") as Language | null;
        if (savedLanguage && languageOptions.some((o) => o.code === savedLanguage)) setLanguage(savedLanguage);
        else if (languageOptions.some((o) => o.code === merged.defaultLanguage)) setLanguage(merged.defaultLanguage as Language);
      }
      setOrderHydrated(true);
    });

    trackEvent("session_start");
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => undefined);
  }, []);

  useEffect(() => { window.localStorage.setItem("restaurant-template-favorites", JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => {
    window.localStorage.setItem("restaurant-template-language", language);
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    if (orderHydrated) window.localStorage.setItem("restaurant-template-current-order-v2", JSON.stringify({ items: orderItems, status: orderStatus, activeOrderId, tableNumber, billRequested }));
  }, [activeOrderId, billRequested, orderHydrated, orderItems, orderStatus, tableNumber]);
  useEffect(() => {
    if (orderHydrated) window.localStorage.setItem("restaurant-template-order-history-v1", JSON.stringify(launchedOrders));
  }, [launchedOrders, orderHydrated]);
  useEffect(() => {
    if (orderHydrated && orderItems.length === 0 && orderStatus !== "idle") setOrderStatus("idle");
  }, [orderHydrated, orderItems.length, orderStatus]);
  useEffect(() => {
    const section = document.getElementById("carta");
    if (!section) return;
    const observer = new IntersectionObserver(([entry]) => setMenuVisible(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (orderHydrated && orderStatus === "sent" && orderItems.length > 0 && !activeOrderId) {
      const id = `R${Date.now().toString().slice(-6)}`;
      const total = orderItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
      setActiveOrderId(id);
      setLaunchedOrders((current) => [{ id, launchedAt: new Date().toISOString(), items: orderItems, total, tableNumber, status: "En preparación" as const }, ...current].slice(0, 30));
    }
  }, [activeOrderId, orderHydrated, orderItems, orderStatus, tableNumber]);
  useEffect(() => {
    setSelectedServing("Pinta");
    setOrderFeedback("");
    if (selected) trackEvent("product_view", { productId: selected.id });
  }, [selected?.id]);

  useEffect(() => {
    // Realtime: cuando el admin guarda, el menu publico se actualiza solo
    const channel = subscribeToConfig((key, value) => {
      if (key === "products") setCatalogProducts(value as Product[]);
      if (key === "menu_settings") setMenuSettings(value as MenuSettings);
      if (key === "app_settings") setAppSettings({ ...DEFAULT_APP_SETTINGS, ...(value as AppSettings) });
      if (key === "banners") setBanners(value as Banner[]);
      if (key === "events") setEvents(value as EventItem[]);
    });
    return () => { channel.unsubscribe(); };
  }, []);

  const brandName = appSettings.businessName.trim() || DEFAULT_APP_SETTINGS.businessName;
  const logoUrl = appSettings.logoUrl.trim() || DEFAULT_APP_SETTINGS.logoUrl;
  const heroImageUrl = appSettings.heroImageUrl.trim() || DEFAULT_APP_SETTINGS.heroImageUrl;
  const displayPrice = (value: number) => formatPrice(value, appSettings.currency);

  // En modo evento el menú es solo para ver: sin carrito, con los precios del evento
  const cartDisabled = (appSettings.cartDisabled ?? false) || appSettings.eventModeActive;
  const priceOf = (product: Product, servingLabel?: string) => displayedPrice(product, appSettings.eventModeActive, servingLabel);
  const servingsOf = (product: Product) => offeredServings(product, appSettings.eventModeActive);

  const activePool = appSettings.eventModeActive
    ? catalogProducts.filter((p) => p.eventoMenu)
    : catalogProducts;
  // Solo las solapas que tienen productos: promos fuera de horario o una carta de evento sin comida no aparecen
  const shownCategories = productsReady
    ? MENU_CATEGORIES.filter((cat) => activePool.some((p) => inCategory(p, cat, now)))
    : MENU_CATEGORIES.slice(0, 3); // mientras carga, las de siempre
  const shownKey = shownCategories.join(",");

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  // Si la solapa elegida se quedó sin productos (terminó la promo, carta de evento), se pasa a la primera que tenga
  useEffect(() => {
    const shown = shownKey ? shownKey.split(",") as MenuCategory[] : [];
    if (shown.length && !shown.includes(category)) setCategory(shown[0]);
  }, [category, shownKey]);

  const visibleProducts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    return activePool.filter((product) => {
      const matchesCategory = inCategory(product, category, now);
      const content = `${product.name} ${product.description} ${product.tag}`.toLocaleLowerCase("es");
      const matchesGroup = selectedGroups.length === 0 || selectedGroups.includes(product.group);
      const matchesPreferences = selectedPreferences.every((preference) => product.attributes.includes(preference));
      const avoidsAllergens = excludedAllergens.every((allergen) => !product.allergens.includes(allergen));
      const matchesBeerStyle = selectedBeerStyles.length === 0 || (product.beerStyle ? selectedBeerStyles.includes(product.beerStyle) : false);
      return matchesCategory && matchesGroup && matchesPreferences && avoidsAllergens && matchesBeerStyle && (!term || content.includes(term));
    });
  }, [activePool, category, excludedAllergens, now, query, selectedBeerStyles, selectedGroups, selectedPreferences]);

  const relatedProducts = selected
    ? selected.relatedIds
        .map((id) => activePool.find((product) => product.id === id))
        .filter((product): product is Product => Boolean(product))
    : [];

  // Resetear modificadores elegidos cada vez que se abre un nuevo producto
  useEffect(() => { setSelectedModifiers([]); setAddingAnotherUnit(false); }, [selected]);

  const selectedServingOption = selected?.servings?.find((serving) => serving.label === selectedServing);
  const selectedBasePrice = selectedServingOption?.price ?? selected?.price ?? 0;
  const selectedPrice = selectedBasePrice;
  const orderCount = orderItems.reduce((total, item) => total + item.quantity, 0);
  const orderTotal = orderItems.reduce((total, item) => total + (item.unitPrice * item.quantity), 0);
  const launchedTotal = launchedOrders.reduce((total, order) => total + order.total, 0);
  const tablePeople = launchedOrders[launchedOrders.length - 1]?.guestCount;
  const tr = (text: string) => translate(language, text);

  function toggleListValue(value: string, setter: Dispatch<SetStateAction<string[]>>) {
    setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function changeCategory(next: MenuCategory) {
    trackEvent("category_switch", { filterType: next });
    setCategory(next);
    setSelectedGroups([]);
    setSelectedPreferences([]);
    setExcludedAllergens([]);
    setSelectedBeerStyles([]);
  }

  function clearSidebarFilters() {
    setSelectedGroups([]);
    setSelectedPreferences([]);
    setExcludedAllergens([]);
    setSelectedBeerStyles([]);
  }

  function toggleFavorite(id: string) {
    setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  // Opciones elegidas, con repetidas (ej. dos Golden en el Happy Hour), en orden estable para la key del carrito
  // Producto del menú que corresponde a una opción de FUDO, para mostrarla con su foto y su nombre
  function menuMatchForOption(option: { name: string; fudoProductId: string }) {
    for (const p of catalogProducts) {
      if (p.category === "Promociones") continue;
      if (p.fudoData?.productId === option.fudoProductId) return { label: tr(p.name), image: p.image };
      const serving = Object.entries(p.fudoData?.servingIds ?? {}).find(([, id]) => id === option.fudoProductId)?.[0];
      if (serving) return { label: `${tr(p.name)} · ${tr(serving)}`, image: p.image };
    }
    return { label: option.name, image: undefined };
  }

  function chosenModifiersOf(product: Product) {
    const options = product.fudoData?.modifierOptions ?? [];
    return [...selectedModifiers].sort()
      .map((id) => options.find((o) => o.fudoProductId === id))
      .filter((o): o is { name: string; fudoProductId: string } => Boolean(o))
      .map((o) => ({ name: menuMatchForOption(o).label, fudoProductId: o.fudoProductId }));
  }

  function addSelectedToOrder() {
    if (!selected || orderStatus === "sent") return;
    trackEvent("cart_add", { productId: selected.id });

    // Para combos con modificadores, la key incluye las opciones elegidas para permitir distintas selecciones
    const chosenMods = chosenModifiersOf(selected);
    const modKey = chosenMods.length > 0 ? `:mods:${chosenMods.map((m) => m.fudoProductId).join(",")}` : "";
    const key = selectedServingOption
      ? `${selected.id}:${selectedServingOption.label}`
      : `${selected.id}${modKey}`;

    setOrderItems((current) => {
      const existing = current.find((item) => item.key === key);
      if (existing) return current.map((item) => item.key === key ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, {
        key,
        productId: selected.id,
        fudoProductId: selectedServingOption
          ? selected.fudoData?.servingIds?.[selectedServingOption.label]
          : selected.fudoData?.productId,
        fudoCategoryId: selected.fudoData?.categoryId !== undefined ? String(selected.fudoData.categoryId) : undefined,
        name: selected.name,
        image: selected.image,
        serving: selectedServingOption?.label,
        volume: selectedServingOption?.volume,
        unitPrice: selectedPrice,
        quantity: 1,
        modifiers: chosenMods.length > 0 ? chosenMods : undefined,
      }];
    });
    setOrderStatus("draft");
    setOrderFeedback(`${selected.name} · ${selectedServingOption?.label ?? "1 unidad"}`);
  }

  function changeOrderQuantity(key: string, change: number) {
    if (orderStatus === "sent") return;
    setOrderItems((current) => {
      const updated = current
        .map((item) => item.key === key ? { ...item, quantity: item.quantity + change } : item)
        .filter((item) => item.quantity > 0);
      return updated;
    });
  }

  const isOnPremise = true;

  function launchOrder() {
    if (!orderItems.length || orderStatus !== "draft") return;
    // Si ya hay pedidos lanzados, reusar los datos existentes sin mostrar el prompt
    if (launchedOrders.length > 0 && tableNumber) {
      const prev = launchedOrders[0];
      doLaunchOrder(tableNumber, prev.guestName ?? "", prev.guestPhone ?? "", prev.guestCount ? String(prev.guestCount) : "");
      return;
    }
    setTableDraft(tableNumber);
    setGuestNameDraft("");
    setGuestCountDraft("");
    setTablePromptOpen(true);
  }

  function confirmLaunchOrder(event: FormEvent) {
    event.preventDefault();
    doLaunchOrder(tableDraft.trim(), guestNameDraft.trim(), guestPhoneDraft.trim(), guestCountDraft);
  }

  function doLaunchOrder(confirmedTable: string, guestName: string, guestPhone: string, guestCount: string) {
    trackEvent("cart_send");
    if (!/^\d{1,3}$/.test(confirmedTable)) return;
    const id = `R${Date.now().toString().slice(-6)}`;
    const record: LaunchedOrder = {
      id,
      launchedAt: new Date().toISOString(),
      items: orderItems,
      total: orderTotal,
      tableNumber: confirmedTable,
      guestName: guestName || undefined,
      guestPhone: guestPhone || undefined,
      guestCount: guestCount ? Number(guestCount) : undefined,
      status: "En preparación",
    };
    setLaunchedOrders((current) => [record, ...current].slice(0, 30));
    setTableNumber(confirmedTable);
    setBillRequested(false);
    setOrderItems([]);
    setOrderStatus("idle");
    setActiveOrderId(null);
    setTablePromptOpen(false);
    setOrderOpen(false);
    setOrderFeedback("");

    // Persistir en Supabase para métricas y envío a FUDO (fire-and-forget)
    const idempotencyKey = crypto.randomUUID();
    const lines = record.items.map((item) => ({
      lineId: item.key,
      productId: item.productId,
      fudoProductId: item.fudoProductId,
      fudoCategoryId: item.fudoCategoryId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      comment: [
        ...(item.removedIngredients ?? []), // van a cocina tal cual se cargaron en el admin
        item.customNote ?? "",
      ].filter(Boolean).join(", ") || undefined,
      modifiers: item.modifiers,
    }));

    fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey,
        mesaNumero: confirmedTable,
        people: record.guestCount ?? 1,
        customerName: record.guestName,
        customerPhone: record.guestPhone,
        lines,
      }),
    }).catch(() => { /* fallo silencioso — el pedido ya quedó en localStorage */ });
  }

  function requestBill() {
    if (!launchedOrders.length || !tableNumber) return;
    trackEvent("bill_request");
    setLaunchedOrders((current) => current.map((order) => ({ ...order, status: "Cuenta solicitada" })));
    setBillRequested(true);
    setHistoryOpen(true);
  }

  function answer(label: string, text: string, ids: string[]) {
    const now = Date.now();
    setMessages((current) => [...current, { id: now, role: "user", text: label }, { id: now + 1, role: "assistant", text }]);
    setRecommended(ids);
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    const clean = message.trim();
    if (!clean) return;
    const normalized = clean.toLocaleLowerCase("es");
    let suggestion = quickSuggestions[2];
    if (/liviano|entrada|fresco|compart/.test(normalized)) suggestion = quickSuggestions[0];
    if (/principal|carne|vegetariano|risotto/.test(normalized)) suggestion = quickSuggestions[1];
    answer(clean, suggestion.answer, suggestion.ids);
    setMessage("");
  }

  return (
    <>
    <main className={orderItems.length ? "site-shell has-active-order" : "site-shell"} style={{ "--yellow": appSettings.accentColor } as CSSProperties}>
      <div className="bg-wave bg-wave-1" aria-hidden="true"/>
      <div className="bg-wave bg-wave-2" aria-hidden="true"/>
      <div className="bg-wave bg-wave-3" aria-hidden="true"/>
      {/* Luces de guirnalda: caen desde las esquinas superiores en diagonal */}
      <div className="string-lights-overlay" aria-hidden="true">
        {/* SVG mobile: paths diseñados para proporciones de teléfono */}
        <svg className="lights-mobile" viewBox="0 0 390 310" preserveAspectRatio="xMidYMin slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="glow-m">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <path d="M 185,0 C 185,130 40,230 0,290" stroke="rgba(30,12,3,0.65)" strokeWidth="2" fill="none" strokeLinecap="round"/>
          <path d="M 205,0 C 205,130 350,230 390,290" stroke="rgba(30,12,3,0.65)" strokeWidth="2" fill="none" strokeLinecap="round"/>
          {[[177,54],[154,108],[121,161],[84,212],[42,258],[6,285]].map(([x,y],i) => (
            <g key={`bml-${i}`}>
              <circle cx={x} cy={y-4} r="3" fill="rgba(20,8,2,0.8)"/>
              <circle cx={x} cy={y+7} r="8" fill="#f5e060" filter="url(#glow-m)" opacity="0.95"/>
              <circle cx={x} cy={y+7} r="8" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1"/>
            </g>
          ))}
          {[[213,54],[236,108],[269,161],[306,212],[348,258],[384,285]].map(([x,y],i) => (
            <g key={`bmr-${i}`}>
              <circle cx={x} cy={y-4} r="3" fill="rgba(20,8,2,0.8)"/>
              <circle cx={x} cy={y+7} r="8" fill="#f5e060" filter="url(#glow-m)" opacity="0.95"/>
              <circle cx={x} cy={y+7} r="8" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1"/>
            </g>
          ))}

        </svg>
        {/* SVG desktop */}
        <svg className="lights-desktop" viewBox="0 0 1440 620" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="glow">
              <feGaussianBlur stdDeviation="4" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          {/* Cables separados: nacen a ~100px del centro y caen con curva catenaria */}
          {/* Cable izquierdo: desde (620,0) con sag pronunciado hacia (0,420) */}
          <path d="M 620,0 C 620,210 180,300 0,420" stroke="rgba(30,12,3,0.65)" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
          {/* Cable derecho: desde (820,0) con sag pronunciado hacia (1440,420) */}
          <path d="M 820,0 C 820,210 1260,300 1440,420" stroke="rgba(30,12,3,0.65)" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
          {/* Bulbos izquierdos sobre C(620,0)(620,210)(180,300)(0,420) */}
          {[
            [608, 57],
            [551, 133],
            [459, 200],
            [345, 259],
            [222, 314],
            [102, 367],
          ].map(([x, y], i) => (
            <g key={`bl-${i}`}>
              <circle cx={x} cy={y - 5} r="4" fill="rgba(20,8,2,0.8)"/>
              <circle cx={x} cy={y + 9} r="10" fill="#f5e060" filter="url(#glow)" opacity="0.95"/>
              <circle cx={x} cy={y + 9} r="10" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1"/>
            </g>
          ))}
          {/* Bulbos derechos (espejo: 1440 - x_izq) */}
          {[
            [832,  57],
            [889,  133],
            [981,  200],
            [1095, 259],
            [1218, 314],
            [1338, 367],
          ].map(([x, y], i) => (
            <g key={`br-${i}`}>
              <circle cx={x} cy={y - 5} r="4" fill="rgba(20,8,2,0.8)"/>
              <circle cx={x} cy={y + 9} r="10" fill="#f5e060" filter="url(#glow)" opacity="0.95"/>
              <circle cx={x} cy={y + 9} r="10" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1"/>
            </g>
          ))}
        </svg>
      </div>
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label={`${brandName}, inicio`}>
          <img src={logoUrl} alt={brandName} />
        </a>
        <div className="header-actions">
          <span className="general-menu">{tr("MENÚ GENERAL")}</span>
          <button className="order-history-link" onClick={() => setHistoryOpen(true)}><Icon name="receipt" size={16}/><span>{tr("Mis pedidos")}</span>{launchedOrders.length > 0 && <b>{launchedOrders.length}</b>}</button>
        </div>
      </header>

      <nav className="language-bar" aria-label="Seleccionar idioma">
        <div className="lang-picker">
          <span className="lang-picker-label">{tr("Idioma")}</span>
          <div className="lang-picker-control">
            <button className="lang-picker-btn" onClick={() => setLangOpen(o => !o)} aria-expanded={langOpen}>
              {languageOptions.find(o => o.code === language)?.label ?? "Español"}
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
            {langOpen && (
              <ul className="lang-picker-list" role="listbox">
                {languageOptions.map(option => (
                  <li key={option.code} role="option" aria-selected={option.code === language}
                    onClick={() => { setLanguage(option.code as Language); setLangOpen(false); trackEvent("language_change", { language: option.code }); }}>
                    {option.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </nav>

      <section className="hero" id="inicio">
        <div className="hero-copy">
          <img className="hero-logo-carta" src={logoUrl} alt={brandName} />
          <div className="hero-welcome-banner">
            <h1>{tr(appSettings.heroTitle)} <em>{tr(appSettings.heroHighlight)}</em></h1>
          </div>
        </div>
      </section>

      {!appSettings.eventModeActive && banners.filter((b) => b.visible).length > 0 && (
        <NovedadesSlider banners={banners.filter((b) => b.visible)} tr={tr} />
      )}

      <section className="menu-section" id="carta">
        <div className="section-heading">
          <div><p className="eyebrow dark">{tr("NUESTRA CARTA")}</p><h2>{tr("Algo para cada momento.")}</h2></div>
          <label className="search-box"><Icon name="search" size={18}/><input type="search" placeholder={tr("Buscar en el menú")} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={tr("Buscar en el menú")}/></label>
        </div>

        {appSettings.eventModeActive && <div className="event-mode-banner"><span>🎉</span><div><strong>{tr("Carta de evento")}</strong><small>{tr("Esta noche mostramos una selección especial.")}</small></div></div>}

        <div className="category-tabs">
          {shownCategories.includes("Cocina") && <button className={category === "Cocina" ? "active" : ""} onClick={() => changeCategory("Cocina")}>{tr("Comida")}</button>}
          {shownCategories.includes("Cervezas") && <button className={category === "Cervezas" ? "active" : ""} onClick={() => changeCategory("Cervezas")}>{tr("Bebida")}</button>}
          {shownCategories.includes("SinTACC") && <button className={category === "SinTACC" ? "active" : ""} onClick={() => changeCategory("SinTACC")}>{tr("Sin TACC")}</button>}
          {shownCategories.includes("Promociones") && <button className={category === "Promociones" ? "active" : ""} onClick={() => changeCategory("Promociones")}>🏷️ {tr("Promociones")}</button>}
          {/* En la carta de evento, Eventos queda siempre */}
          {(appSettings.eventModeActive || events.some((e) => e.active)) && <button onClick={() => { trackEvent("events_open"); setEventsOpen(true); }}>📅 {tr("Eventos")}</button>}
        </div>

        <div className="menu-layout">
          <div className="menu-results">

            {!productsReady ? <div className="results-summary"><span>{tr("Cargando...")}</span></div> : <>
            <div className="results-summary"><span>{visibleProducts.length} {tr(visibleProducts.length === 1 ? "resultado" : "resultados")}</span></div>

            {visibleProducts.length ? <div className="product-grid">
              {Object.entries(
                visibleProducts.reduce<Record<string, typeof visibleProducts>>((acc, p) => { (acc[p.group] ??= []).push(p); return acc; }, {})
              ).map(([group, groupProducts]) => (
                <Fragment key={group}>
                  <div className="product-group-header"><h3>{tr(group)}</h3></div>
                  {groupProducts.map((product) => (
                    <article className={`product-card${product.outOfStock ? " out-of-stock" : ""}`} key={product.id} data-style={product.beerStyle?.toLowerCase().replace(/\s+/g, "-")}>
                      <div className="product-visual-wrap">
                        <button className="product-visual" onClick={() => setSelected(product)} aria-label={`${tr("Ver detalle")} ${tr(product.name)}`}>
                          {product.image ? <img className={product.id === "filet-numa" ? "filet-numa-image" : undefined} src={product.image} alt={`${tr(product.name)} · ${brandName}`} /> : <span className="photo-pending"><Icon name="expand" size={20}/><strong>{tr("Foto real pendiente")}</strong></span>}
                          <span className="product-tag">{tr(product.tag)}</span>
                          <span className="expand-label"><Icon name="expand" size={14}/> {tr("Ver detalle")}</span>
                        </button>
                        {product.outOfStock && <span className="out-of-stock-badge">{tr("Sin stock")}</span>}
                      </div>
                      <div className="product-info">

                        <div className="product-title"><button onClick={() => setSelected(product)}><h3>{tr(product.name)}</h3></button><button className={favorites.includes(product.id) ? "favorite active" : "favorite"} onClick={() => toggleFavorite(product.id)} aria-label={`Guardar ${tr(product.name)}`}><Icon name="heart" size={18}/></button></div>
                        <p>{tr(product.description)}</p>
                        {(() => {
                          const cardPrice = product.servings ? Math.min(...servingsOf(product)!.map(s => priceOf(product, s.label))) : priceOf(product);
                          const cartQty = !product.servings ? (orderItems.find(i => i.key === product.id)?.quantity ?? 0) : 0;
                          const btnLabel = product.outOfStock
                            ? <>{tr("Sin stock")}</>
                            : product.servings
                              ? <>{tr("Ver detalle")} <Icon name="arrow" size={15}/></>
                              : cartQty > 0
                                ? <><span className="cart-qty-badge">{cartQty}</span>{tr("en el pedido")}</>
                                : <>{tr("Añadir al carrito")} <Icon name="plus" size={15}/></>;
                          return (
                            <div className="product-footer">
                              <span>
                                <small>{product.servings ? tr("Desde") : ""}</small>
                                <strong>{displayPrice(cardPrice)}</strong>
                              </span>
                              {!cartDisabled && <button disabled={product.outOfStock} className={product.outOfStock ? "add-to-cart-btn out-of-stock-btn" : cartQty > 0 && !product.servings ? "add-to-cart-btn in-cart" : "add-to-cart-btn"} onClick={(e) => { e.stopPropagation(); if (product.outOfStock) return; if (product.servings || product.fudoData?.modifierOptions?.length) { setSelected(product); } else { const cardUnitPrice = product.price; setOrderItems(prev => { const key = product.id; const existing = prev.find(i => i.key === key); return existing ? prev.map(i => i.key === key ? {...i, quantity: i.quantity + 1, unitPrice: cardUnitPrice} : i) : [...prev, { key, productId: product.id, fudoProductId: product.fudoData?.productId, fudoCategoryId: product.fudoData?.categoryId !== undefined ? String(product.fudoData.categoryId) : undefined, name: product.name, image: product.image, unitPrice: cardUnitPrice, quantity: 1 }]; }); setOrderStatus("draft"); } }}>{btnLabel}</button>}
                            </div>
                          );
                        })()}
                      </div>
                    </article>
                  ))}
                </Fragment>
              ))}
            </div> : <div className="empty-state"><h3>{tr("No hay resultados con esos filtros")}</h3><p>{tr("Probá desmarcar una opción o limpiar los filtros.")}</p><button onClick={clearSidebarFilters}>{tr("Limpiar filtros")}</button></div>}
            </>}
          </div>
        </div>
      </section>

      {(() => {
        const activeEvents = events.filter(e => e.active);
        if (!activeEvents.length) return null;
        return <>
          <div className="events-section-heading">
            <p className="eyebrow dark">{tr("Eventos")}</p>
          </div>
          <EventsBannerSlider events={activeEvents} brandName={brandName} onOpen={() => setEventsOpen(true)} tr={tr} />
        </>;
      })()}

      <footer><img src={logoUrl} alt={brandName}/><p>{brandName} · {tr(appSettings.brandTagline)} · {tr("La mesa se confirma al lanzar el pedido.")}</p></footer>

      {eventsOpen && <div className="overlay" onMouseDown={() => setEventsOpen(false)}>
        <section className="events-panel" role="dialog" aria-modal="true" aria-labelledby="events-title" onMouseDown={(e) => e.stopPropagation()}>
          <header className="events-panel-header"><div><p>{tr("AGENDA")} · {brandName.toLocaleUpperCase("es")}</p><h2 id="events-title">{tr("Agenda de eventos")}</h2><span>{tr("Conocé las próximas experiencias del restaurante.")}</span></div><button onClick={() => setEventsOpen(false)} aria-label="Cerrar agenda"><Icon name="close"/></button></header>
          <div className="events-list">
            {events.filter(e => e.active).map((ev) => <EventCard key={ev.id} ev={ev}/>)}
            <div className="events-coming-soon"><span>＋</span><div><strong>{tr("Más eventos próximamente")}</strong><p>{tr("La agenda está preparada para incorporar todas las fechas de cada mes.")}</p></div></div>
          </div>
        </section>
      </div>}

      {!cartDisabled && orderItems.length > 0 && <button className={orderStatus === "sent" ? "order-status-bar sent" : "order-status-bar"} onClick={() => setOrderOpen(true)} aria-label="Abrir carrito">
        <span className="order-status-icon"><Icon name={orderStatus === "sent" ? "receipt" : "plus"} size={20}/><b>{orderCount}</b></span>
        <span><small>{tr(orderStatus === "sent" ? "PEDIDO LANZADO" : "CARRITO ABIERTO")}</small><strong>{tr(orderStatus === "sent" ? "Ver estado del pedido" : "Revisar carrito")}</strong></span>
        <span className="order-status-total">{displayPrice(orderTotal)}<Icon name="arrow" size={17}/></span>
      </button>}

      {orderOpen && !cartDisabled && <div className="overlay" onMouseDown={() => setOrderOpen(false)}>
        <section className="order-panel" role="dialog" aria-modal="true" aria-labelledby="order-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className="order-panel-header">
            <div><p>{tr(orderStatus === "sent" ? "PEDIDO LANZADO" : "CARRITO ABIERTO")}</p><h2 id="order-title">{tr(orderStatus === "sent" ? "Tu pedido está en marcha" : "Revisá antes de lanzarlo")}</h2></div>
            <button onClick={() => setOrderOpen(false)} aria-label="Cerrar resumen"><Icon name="close"/></button>
          </header>
          {orderStatus === "draft" && <div className="cart-open-message"><strong>{tr("El pedido todavía no fue lanzado.")}</strong><span>{tr("Podés seguir agregando productos o cerrar el carrito cuando esté completo.")}</span></div>}
          {orderStatus === "sent" && <div className="order-sent-message"><span><Icon name="receipt" size={23}/></span><div><strong>{tr("Pedido enviado correctamente")}</strong><p>Esta es una simulación. La confirmación real se conectará con el sistema del local y la mesa.</p></div></div>}
          <div className="order-items">
            {orderItems.map((item) => (
              <article key={item.key}>
                {item.image ? <img src={item.image} alt=""/> : <span className="order-item-placeholder"/>}
                <div className="order-item-copy">
                  <strong>{tr(item.name)}</strong>
                  {item.serving && <small>{tr(item.serving)} · {item.volume}</small>}
                  {item.modifiers?.length ? <small className="removed-ingredients">{Object.entries(item.modifiers.reduce<Record<string, number>>((acc, m) => { acc[m.name] = (acc[m.name] ?? 0) + 1; return acc; }, {})).map(([name, n]) => n > 1 ? `${n}× ${name}` : name).join(", ")}</small> : null}
                  {item.removedIngredients?.length ? <small className="removed-ingredients">{item.removedIngredients.map(tr).join(", ")}</small> : null}
                  {item.customNote ? <small className="removed-ingredients">📝 {item.customNote}</small> : null}
                  <b>{displayPrice(item.unitPrice)}</b>
                </div>
                <div className="order-item-actions">
                  {(() => { const prod = catalogProducts.find(p => p.id === item.productId); const hasCocina = prod?.category === "Cocina"; return hasCocina ? <button className="customize-inline-btn" onClick={() => setCustomizeItemKey(item.key)} disabled={orderStatus === "sent"}>✎</button> : null; })()}
                  <div className="quantity-control" aria-label={`Cantidad de ${item.name}`}>
                    <button onClick={() => changeOrderQuantity(item.key, -1)} disabled={orderStatus === "sent"} aria-label={`Quitar una unidad de ${item.name}`}>−</button>
                    <span>{item.quantity}</span>
                    <button onClick={() => changeOrderQuantity(item.key, 1)} disabled={orderStatus === "sent"} aria-label={`Agregar una unidad de ${item.name}`}>+</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="order-total"><span><small>{orderCount} {tr(orderCount === 1 ? "producto" : "productos")}</small><strong>{tr("Total")}</strong></span><b>{displayPrice(orderTotal)}</b></div>
          {orderStatus === "draft" ? (
            isOnPremise
              ? <button className="launch-order" onClick={launchOrder}><Icon name="arrow" size={19}/> {tr("Cerrar carrito y lanzar pedido")}</button>
              : <div className="order-blocked"><span>🔒</span><p>El pedido solo se puede lanzar desde adentro de la cervecería. Escaneá el QR de tu mesa para habilitarlo.</p></div>
          ) : <button className="close-order" onClick={requestBill}>{tr("Solicitar la cuenta")}</button>}
          <p className="order-panel-note">{tr("Antes de lanzar el pedido te pediremos confirmar el número de mesa.")}</p>
        </section>
      </div>}

      {customizeItemKey && (() => {
        const item = orderItems.find(i => i.key === customizeItemKey);
        const prod = item ? catalogProducts.find(p => p.id === item.productId) : null;
        const ingredients = prod?.removableIngredients ?? [];
        const removed = item?.removedIngredients ?? [];
        const toggle = (ing: string) => setOrderItems(prev => prev.map(i => i.key === customizeItemKey ? { ...i, removedIngredients: removed.includes(ing) ? removed.filter(r => r !== ing) : [...removed, ing] } : i));
        return <div className="overlay customize-overlay" onMouseDown={() => setCustomizeItemKey(null)}>
          <section className="customize-dialog" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
            <button className="modal-close light" onClick={() => setCustomizeItemKey(null)} aria-label="Cerrar"><Icon name="close"/></button>
            <p className="eyebrow">{tr("PERSONALIZAR PEDIDO")}</p>
            <h2>{tr(item?.name ?? "")}{item?.serving ? <small> · {tr(item.serving)}</small> : ""}</h2>
            {/* Se muestran traducidas, pero a cocina van tal cual se cargaron en el admin */}
            {ingredients.length > 0
              ? <><p className="customize-hint">{tr("Tocá las opciones que querés para este plato.")}</p><div className="customize-ingredient-list">{ingredients.map(ing => <button key={ing} className={removed.includes(ing) ? "ingredient-chip selected" : "ingredient-chip"} onClick={() => toggle(ing)} aria-pressed={removed.includes(ing)}>{removed.includes(ing) ? <span>✓</span> : <span>+</span>}{tr(ing)}</button>)}</div></>
              : <p className="customize-hint">{tr("Este producto no tiene ingredientes editables cargados todavía.")}</p>
            }
            {removed.length > 0 && <p className="customize-summary">{tr("Elegiste:")} {removed.map(tr).join(", ")}</p>}
            <button className="customize-confirm" onClick={() => setCustomizeItemKey(null)}>{tr("Listo")}</button>
          </section>
        </div>;
      })()}

      {tablePromptOpen && !cartDisabled && <div className="overlay" onMouseDown={() => setTablePromptOpen(false)}>
        <section className="table-dialog" role="dialog" aria-modal="true" aria-labelledby="table-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="modal-close light" onClick={() => setTablePromptOpen(false)} aria-label="Cerrar"><Icon name="close"/></button>
          <span className="table-dialog-number">{tableDraft || "—"}</span>
          <p className="eyebrow">{tr("IDENTIFICAR PEDIDO")}</p>
          <h2 id="table-dialog-title">{tr("¿Cuál es tu número de mesa?")}</h2>
          <p>{tr("Lo necesitamos para que el personal reciba el pedido en el lugar correcto.")}</p>
          <form onSubmit={confirmLaunchOrder}>
            <label>{tr("Mesa número")}<input type="text" inputMode="numeric" pattern="[0-9]{1,3}" maxLength={3} value={tableDraft} onChange={(event) => setTableDraft(event.target.value.replace(/\D/g, ""))} readOnly={launchedOrders.length > 0} autoFocus aria-label={tr("Mesa número")}/></label>
            {launchedOrders.length > 0 && <small>{tr("La mesa queda fijada durante esta cuenta. Se libera después del cobro.")}</small>}
            <label>{tr("Nombre y apellido")}<input type="text" value={guestNameDraft} onChange={(event) => setGuestNameDraft(event.target.value)} placeholder={tr("Ej. María González")} aria-label={tr("Nombre y apellido")}/></label>
            <label>{tr("Teléfono")}<input type="tel" value={guestPhoneDraft} onChange={(event) => setGuestPhoneDraft(event.target.value)} placeholder={tr("Ej. +54 9 261 000-0000")} aria-label={tr("Teléfono")}/></label>
            <label>{tr("Personas en la mesa")}<input type="text" inputMode="numeric" maxLength={2} value={guestCountDraft} onChange={(event) => setGuestCountDraft(event.target.value.replace(/\D/g, ""))} placeholder={tr("Ej. 4")} aria-label={tr("Personas en la mesa")}/></label>
            <button type="submit" disabled={!/^\d{1,3}$/.test(tableDraft) || !isOnPremise}>{tr("Confirmar y lanzar pedido")}</button>
          </form>
        </section>
      </div>}

      {historyOpen && <div className="overlay" onMouseDown={() => setHistoryOpen(false)}>
        <section className="history-panel" role="dialog" aria-modal="true" aria-labelledby="history-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className="order-panel-header">
            <div><p>{tr("HISTORIAL LOCAL")}</p><h2 id="history-title">{tr("Mis pedidos")}</h2></div>
            <button onClick={() => setHistoryOpen(false)} aria-label="Cerrar historial"><Icon name="close"/></button>
          </header>
          {cartDisabled ? <div className="history-empty"><span><Icon name="receipt" size={28}/></span><h3>{tr("Hoy no hay servicio a mesa")}</h3><p>{tr("Podés ver nuestra carta y consultarle a un mozo.")}</p></div> : launchedOrders.length ? <><div className={billRequested ? "history-bill-summary requested" : "history-bill-summary"}><div><small>{tr("CUENTA DE LA MESA")}</small><strong>{tr("Mesa")} {tableNumber || launchedOrders[0]?.tableNumber}</strong><span>{launchedOrders.length} {tr(launchedOrders.length === 1 ? "pedido lanzado" : "pedidos lanzados")}</span></div><b>{displayPrice(launchedTotal)}</b></div><div className="launched-orders">
            {launchedOrders.map((order) => <article key={order.id}>
              <header><div><strong>{tr("Pedido")} · {tr("Mesa")} {order.tableNumber || tableNumber}</strong>{(order.guestName || order.guestCount) && <small>{order.guestName}{order.guestName && order.guestCount ? " · " : ""}{order.guestCount ? `${order.guestCount} ${tr(order.guestCount === 1 ? "persona" : "personas")}` : ""}</small>}<time dateTime={order.launchedAt}>{formatOrderDate(order.launchedAt, language)}</time></div><span className={order.status === "Cerrado" ? "closed" : order.status === "Cuenta solicitada" ? "requested" : ""}>{tr(order.status)}</span></header>
              <div className="launched-order-items">{order.items.map((item) => <p key={item.key}><span><b>{item.quantity}×</b> {tr(item.name)}{item.serving ? ` · ${tr(item.serving)} (${item.volume})` : ""}</span><strong>{displayPrice(item.unitPrice * item.quantity)}</strong></p>)}</div>
              <div className="launched-order-total"><span>{order.items.reduce((total, item) => total + item.quantity, 0)} {tr("productos")}</span><strong>{displayPrice(order.total)}</strong></div>
            </article>)}
          </div><div className="history-account-actions">{tablePeople ? <div className="launched-order-per-person"><span>{tr("Por persona")} · {tablePeople} {tr(tablePeople === 1 ? "persona" : "personas")}</span><strong>{displayPrice(Math.ceil(launchedTotal / tablePeople))}</strong></div> : null}{!billRequested && <button className="request-bill-history" onClick={requestBill}>{tr("Solicitar la cuenta")} · {displayPrice(launchedTotal)}</button>}</div></> : <div className="history-empty"><span><Icon name="receipt" size={28}/></span><h3>{tr("Todavía no lanzaste pedidos")}</h3><p>{tr("Cuando cierres un carrito y lo lances, aparecerá acá con su estado y detalle completo.")}</p></div>}
        </section>
      </div>}

      {selected && <div className="overlay" onMouseDown={() => setSelected(null)}>
        <article className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="product-title" data-style={selected.beerStyle?.toLowerCase().replace(/\s+/g, "-")} onMouseDown={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={() => setSelected(null)} aria-label="Cerrar"><Icon name="close"/></button>
          <div className="detail-image">{selected.image ? <img className={selected.id === "filet-numa" ? "filet-numa-image" : undefined} src={selected.image} alt={`${selected.name} de ${brandName}, vista ampliada`}/> : <div className="detail-photo-pending"><Icon name="expand" size={28}/><strong>{tr("Fotografía real pendiente")}</strong><small>{tr("Este espacio se reemplazará por la imagen real del restaurante.")}</small></div>}</div>
          <div className="detail-copy">
            <h2 id="product-title">{tr(selected.name)}</h2>
            {selected.beerProfile && <section className="beer-profile" aria-label={`Características de ${selected.name}`}>
              {selected.beerStyle && <p className="beer-style-badge">{selected.beerStyle.toUpperCase()}</p>}
              <div className="beer-descriptors">{selected.beerProfile.descriptors.map((descriptor) => <span key={descriptor}>{tr(descriptor)}</span>)}</div>
              <div className="beer-metrics">
                <div className="beer-metrics-header"><span>{tr("DATOS TÉCNICOS")}</span></div>
                <span>
                  <span className="beer-metric-info"><em>{tr("ALCOHOL %")}</em><small>{tr("Contenido alcohólico por volumen")}</small></span>
                  <strong>{selected.beerProfile.abv}</strong>
                </span>
                <span>
                  <span className="beer-metric-info"><em>{tr("COLOR EBC")}</em><small>{tr("Escala europea de color — mayor valor, más oscura")}</small></span>
                  <strong>{selected.beerProfile.srm}</strong>
                </span>
                <span>
                  <span className="beer-metric-info"><em>{tr("AMARGO IBU")}</em><small>{tr("Unidades de amargor — mayor valor, más amarga")}</small></span>
                  <strong>{selected.beerProfile.ibu}</strong>
                </span>
              </div>
            </section>}
            <p>{tr(selected.description)}</p>

            {selected.servings ? <section className="serving-selector" aria-labelledby="serving-title">
              <div className="detail-section-heading"><div><p>{tr("FORMATO")}</p><h3 id="serving-title">{tr("¿Cómo la querés?")}</h3></div><small>{tr("Precio")}</small></div>
              <div className="serving-options">
                {servingsOf(selected)!.map((serving) => <button key={serving.label} className={selectedServing === serving.label ? "active" : ""} onClick={() => { setSelectedServing(serving.label); setOrderFeedback(""); }} aria-pressed={selectedServing === serving.label}>
                  <span><strong>{tr(serving.label)}</strong><small>{serving.volume}</small></span>
                  <b>{displayPrice(priceOf(selected, serving.label))}</b>
                </button>)}
              </div>
            </section> : <div className="single-price"><span>{tr("Precio")}</span><strong>{displayPrice(priceOf(selected))}</strong></div>}

            <section className="nutrition-card" aria-labelledby="nutrition-title">
              {(selected.category === "Cocina" || selected.category === "Sin TACC") && selected.showNutrition && <>
                <div className="detail-section-heading"><div><p>{tr("INFORMACIÓN NUTRICIONAL")}</p><h3 id="nutrition-title">{tr("Valores nutricionales")}</h3></div><small>{tr("Por 100 g")}</small></div>
                <dl>
                  <div><dt>{tr("Calorías")}</dt><dd>{selected.nutrition.calories}</dd></div>
                  <div><dt>{tr("Grasas")}</dt><dd>{selected.nutrition.fats}</dd></div>
                  <div><dt>{tr("Proteínas")}</dt><dd>{selected.nutrition.proteins}</dd></div>
                  <div><dt>{tr("Carbohidratos")}</dt><dd>{selected.nutrition.carbs}</dd></div>
                  <div><dt>{tr("Azúcares")}</dt><dd>{selected.nutrition.sugars}</dd></div>
                </dl>
              </>}
              <div className="allergen-summary"><strong>{tr("Alérgenos")}</strong><div>{selected.allergens.length ? selected.allergens.map((allergen) => <span className="allergen-item" key={allergen}><i aria-hidden="true">{allergenIcons[allergen] ?? "•"}</i>{tr(allergen)}</span>) : <span className="allergen-item allergen-free"><i aria-hidden="true">✓</i>{tr("Sin alérgenos declarados")}</span>}</div></div>
            </section>
            {(() => {
              const modOptions = selected.fudoData?.modifierOptions ?? [];
              const modMin = selected.fudoData?.modifierMin ?? (modOptions.length > 0 ? 1 : 0);
              const modMax = selected.fudoData?.modifierMax ?? (modOptions.length > 0 ? 1 : 0);
              const chosenMods = chosenModifiersOf(selected);
              const modKey = chosenMods.length > 0 ? `:mods:${chosenMods.map((m) => m.fudoProductId).join(",")}` : "";
              const modalKey = selectedServingOption
                ? `${selected.id}:${selectedServingOption.label}`
                : `${selected.id}${modKey}`;
              const modalItem = orderItems.find(i => i.key === modalKey);
              const modSelectionComplete = modOptions.length === 0 || chosenMods.length >= modMin;

              const openCustomize = () => {
                if (!modalItem) {
                  setOrderItems(prev => [...prev, { key: modalKey, productId: selected.id, fudoProductId: selectedServingOption ? selected.fudoData?.servingIds?.[selectedServingOption.label] : selected.fudoData?.productId, fudoCategoryId: selected.fudoData?.categoryId !== undefined ? String(selected.fudoData.categoryId) : undefined, name: selected.name, image: selected.image, serving: selectedServingOption?.label, unitPrice: selectedPrice, quantity: 1 }]);
                  setOrderStatus("draft");
                }
                setCustomizeItemKey(modalKey);
              };

              if (orderStatus === "sent") {
                return <button className="order-button locked" disabled><Icon name="receipt" size={19}/><span>{tr("PEDIDO LANZADO")}</span></button>;
              }
              if (selected.outOfStock) {
                return <button className="order-button locked" disabled><span>{tr("Sin stock — no disponible ahora")}</span></button>;
              }

              return <>
                {/* Selector de modificadores (combos/promos con grupos en Fudo) */}
                {!cartDisabled && modOptions.length > 0 && (!modalItem || addingAnotherUnit) && (
                  <div className="modifier-selector">
                    <p className="modifier-selector-title">
                      {tr("Elegí")} {modMin === modMax ? modMin : `${modMin}–${modMax}`} {modMin === 1 && modMax === 1 ? tr("opción") : tr("opciones")}
                      {chosenMods.length > 0 && <span className="modifier-count"> ({chosenMods.length}/{modMax})</span>}
                    </p>
                    <div className="combo-beer-options">
                      {modOptions.map((opt) => {
                        const count = selectedModifiers.filter((id) => id === opt.fudoProductId).length;
                        const full = selectedModifiers.length >= modMax;
                        const blocked = modMax > 1 && full && !count;
                        const { label, image } = menuMatchForOption(opt);
                        return (
                          <div key={opt.fudoProductId} className="combo-beer-option-wrap">
                            <button className={`combo-beer-option${count ? " selected" : ""}${blocked ? " maxed" : ""}`} disabled={blocked}
                              aria-label={modMax > 1 ? `Sumar ${label}` : label} aria-pressed={count > 0}
                              onClick={() => modMax === 1
                                ? setSelectedModifiers(count ? [] : [opt.fudoProductId])
                                : !full && setSelectedModifiers((prev) => [...prev, opt.fudoProductId])}>
                              {image && <img src={image} alt=""/>}
                              <span>{tr(label)}</span>
                              {count > 0 && <i>{modMax > 1 ? `${count}×` : "✓"}</i>}
                            </button>
                            {/* Se puede elegir la misma opción más de una vez; con «−» se saca una */}
                            {modMax > 1 && count > 0 && <button className="combo-beer-remove" aria-label={`Quitar una ${label}`}
                              onClick={() => setSelectedModifiers((prev) => { const i = prev.lastIndexOf(opt.fudoProductId); return prev.filter((_, idx) => idx !== i); })}>−</button>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!cartDisabled && (modalItem && modalItem.quantity > 0 && !addingAnotherUnit
                  ? <>
                      {selected.category === "Cocina" && <button className="customize-modal-btn" onClick={openCustomize}>{tr("Le quiero sacar...")}</button>}
                      <div className="modal-quantity-control"><button onClick={() => changeOrderQuantity(modalKey, -1)} aria-label="Quitar uno">−</button><span>{modalItem.quantity} {tr("en el pedido")}</span><button onClick={() => { if (modOptions.length > 0) { setSelectedModifiers([]); setAddingAnotherUnit(true); } else { changeOrderQuantity(modalKey, 1); } }} aria-label="Agregar uno">+</button></div>
                    </>
                  : <button
                      className="order-button"
                      onClick={() => { addSelectedToOrder(); setAddingAnotherUnit(false); }}
                      disabled={!modSelectionComplete}
                      style={!modSelectionComplete ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                    >
                      <Icon name="plus" size={19}/>
                      <span>{tr("Agregar al carrito")} · {displayPrice(selectedPrice)}</span>
                    </button>
                )}
              </>;
            })()}
            {relatedProducts.length > 0 && <section className="cross-sell" aria-labelledby="cross-sell-title">
              <p>{tr("PARA COMPLETAR TU ELECCIÓN")}</p>
              <h3 id="cross-sell-title">{tr("Se puede acompañar con")}</h3>
              <div className="cross-sell-grid">
                {relatedProducts.map((product) => <button key={product.id} onClick={() => { trackEvent("crosssell_click", { productId: selected.id, relatedProductId: product.id }); setSelected(product); }}>
                  {product.image ? <img src={product.image} alt=""/> : <span className="cross-sell-placeholder"><Icon name="expand" size={16}/></span>}
                  <span><strong>{tr(product.name)}</strong><small>{tr(product.group)}{product.beerStyle ? ` · ${tr(product.beerStyle)}` : ""}</small></span>
                  <Icon name="arrow" size={16}/>
                </button>)}
              </div>
            </section>}
          </div>
        </article>
      </div>}

      {assistantOpen && <div className="overlay" onMouseDown={() => setAssistantOpen(false)}>
        <section className="chat-panel" role="dialog" aria-modal="true" aria-labelledby="chat-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className="chat-header"><div className="assistant-symbol small"><Icon name="spark" size={20}/></div><div><h2 id="chat-title">Mozo digital</h2><p><span/> Conoce el menú general</p></div><button onClick={() => setAssistantOpen(false)} aria-label="Cerrar"><Icon name="close"/></button></header>
          <div className="chat-body">
            {messages.map((item) => <div className={`message ${item.role}`} key={item.id}>{item.text}</div>)}
            {recommended.length > 0 && <div className="recommendations">{recommended.map((id) => { const product = catalogProducts.find((item) => item.id === id); return product ? <button key={id} onClick={() => { setAssistantOpen(false); setSelected(product); }}>{product.image ? <img src={product.image} alt=""/> : <span className="recommendation-placeholder"/>}<span>{product.name}</span><Icon name="arrow" size={15}/></button> : null; })}</div>}
            <div className="quick-prompts"><p>Probá preguntando</p><div>{quickSuggestions.map((suggestion) => <button key={suggestion.label} onClick={() => answer(suggestion.label, suggestion.answer, suggestion.ids)}>{suggestion.label}</button>)}</div></div>
          </div>
          <form className="chat-form" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ej: quiero algo para compartir..." aria-label="Escribir al mozo digital"/><button type="submit" aria-label="Enviar"><Icon name="arrow"/></button></form>
          <p className="chat-disclaimer">Demo funcional. Las respuestas se conectarán luego con la carta confirmada.</p>
        </section>
      </div>}

    </main>

    {/* Drawer de filtros: fuera del site-shell para evitar stacking context */}
    <button className={`filter-drawer-trigger${orderItems.length > 0 ? " cart-active" : ""}`} onClick={() => setFilterDrawerOpen(true)} aria-label="Abrir filtros">
      <Icon name="filter" size={18}/>
      <span>{tr("Filtros")}</span>
      {(selectedGroups.length + selectedPreferences.length + excludedAllergens.length + selectedBeerStyles.length) > 0 && (
        <span className="filter-badge">{selectedGroups.length + selectedPreferences.length + excludedAllergens.length + selectedBeerStyles.length}</span>
      )}
    </button>
    {filterDrawerOpen && <div className="filter-drawer-backdrop" onClick={() => setFilterDrawerOpen(false)}/>}
    <aside className={`filter-drawer${filterDrawerOpen ? " open" : ""}`} aria-label="Filtros del menú" aria-hidden={!filterDrawerOpen}>
      <div className="filter-drawer-header">
        <span>{tr("Filtros")}</span>
        <button className="filter-drawer-close" onClick={() => setFilterDrawerOpen(false)} aria-label="Cerrar filtros">✕</button>
      </div>
      <div className="primary-filter-switch">
        {shownCategories.includes("Cocina") && <button className={category === "Cocina" ? "active" : ""} onClick={() => changeCategory("Cocina")} aria-pressed={category === "Cocina"}>{tr("Comida")}</button>}
        {shownCategories.includes("Cervezas") && <button className={category === "Cervezas" ? "active" : ""} onClick={() => changeCategory("Cervezas")} aria-pressed={category === "Cervezas"}>{tr("Bebida")}</button>}
        {shownCategories.includes("SinTACC") && <button className={category === "SinTACC" ? "active" : ""} onClick={() => changeCategory("SinTACC")} aria-pressed={category === "SinTACC"}>{tr("Sin TACC")}</button>}
      </div>
      {category === "Cocina" ? <>
        <div className="filter-family">
          <p>{tr("Tipo de comida")}</p>
          {foodGroups.map((filter) => <button key={filter} className={selectedGroups.includes(filter) ? "selected" : ""} onClick={() => { toggleListValue(filter, setSelectedGroups); trackEvent("filter_use", { filterName: filter, filterType: "foodGroup" }); }}><span>{selectedGroups.includes(filter) ? "✓" : ""}</span>{tr(filter)}</button>)}
        </div>
        <div className="filter-family">
          <p>{tr("Preferencias")}</p>
          {foodPreferences.map((filter) => <button key={filter} className={selectedPreferences.includes(filter) ? "selected" : ""} onClick={() => { toggleListValue(filter, setSelectedPreferences); trackEvent("filter_use", { filterName: filter, filterType: "preference" }); }}><span>{selectedPreferences.includes(filter) ? "✓" : ""}</span>{tr(filter)}</button>)}
        </div>
        <div className="filter-family allergen-family">
          <p>{tr("Evitar alérgenos")}</p>
          {allergenOptions.map((filter) => <button key={filter} className={excludedAllergens.includes(filter) ? "selected" : ""} onClick={() => { toggleListValue(filter, setExcludedAllergens); trackEvent("filter_use", { filterName: filter, filterType: "allergen" }); }}><span>{excludedAllergens.includes(filter) ? "✓" : ""}</span>{tr(filter)}</button>)}
        </div>
      </> : <>
        <div className="filter-family">
          <p>{tr("Tipo de bebida")}</p>
          {drinkGroups.map((filter) => <button key={filter} className={selectedGroups.includes(filter) ? "selected" : ""} onClick={() => { toggleListValue(filter, setSelectedGroups); trackEvent("filter_use", { filterName: filter, filterType: "drinkGroup" }); }}><span>{selectedGroups.includes(filter) ? "✓" : ""}</span>{tr(filter)}</button>)}
        </div>
        {selectedGroups.includes("Cerveza") && <div className="filter-family nested-filter">
          <p>{tr("Estilo de cerveza")}</p>
          {beerStyles.map((filter) => <button key={filter} className={selectedBeerStyles.includes(filter) ? "selected" : ""} onClick={() => { toggleListValue(filter, setSelectedBeerStyles); trackEvent("filter_use", { filterName: filter, filterType: "beerStyle" }); }}><span>{selectedBeerStyles.includes(filter) ? "✓" : ""}</span>{tr(filter)}</button>)}
        </div>}
      </>}
      {(selectedGroups.length + selectedPreferences.length + excludedAllergens.length + selectedBeerStyles.length) > 0 && (
        <button className="clear-sidebar" onClick={() => { clearSidebarFilters(); setFilterDrawerOpen(false); }}>{tr("Limpiar filtros")}</button>
      )}
      <p className="filter-demo-note">{tr("Datos demostrativos hasta validar la carta.")}</p>
    </aside>
  </>
  );
}
