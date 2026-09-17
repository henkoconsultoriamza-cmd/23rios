"use client";

import { CSSProperties, Dispatch, Fragment, FormEvent, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { Language, languageOptions, translate } from "./translations";
import { ADMIN_APP_SETTINGS_KEY, AppSettings, DEFAULT_APP_SETTINGS, DEFAULT_MENU_SETTINGS, DEFAULT_PRODUCTS, MENU_PRODUCTS_STORAGE_KEY, MENU_SETTINGS_STORAGE_KEY, MenuSettings, Product, mergeDefaultProductImages } from "./menu-data";
import { trackEvent } from "./analytics";
import { Banner, BANNERS_STORAGE_KEY, DEFAULT_BANNERS } from "./banner-data";

type Message = { id: number; role: "assistant" | "user"; text: string };
type OrderStatus = "idle" | "draft" | "sent";
type OrderItem = {
  key: string;
  productId: string;
  name: string;
  image?: string;
  serving?: string;
  volume?: string;
  unitPrice: number;
  quantity: number;
};
type LaunchedOrder = {
  id: string;
  launchedAt: string;
  items: OrderItem[];
  total: number;
  tableNumber: string;
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

function Icon({ name, size = 20 }: { name: "search" | "spark" | "arrow" | "close" | "heart" | "expand" | "bell" | "receipt" | "plus"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>;
  if (name === "spark") return <svg {...common}><path d="M12 2c.7 5.5 4.5 9.3 10 10-5.5.7-9.3 4.5-10 10-.7-5.5-4.5-9.3-10-10 5.5-.7 9.3-4.5 10-10Z"/></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14M14 7l5 5-5 5"/></svg>;
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>;
  if (name === "expand") return <svg {...common}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg>;
  if (name === "bell") return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>;
  if (name === "receipt") return <svg {...common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>;
  return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
}

function formatPrice(value: number, currency: AppSettings["currency"]) {
  const symbol = currency === "USD" ? "US$" : currency === "BRL" ? "R$" : "$";
  return `${symbol} ${value.toLocaleString("es-AR")}`;
}

function formatOrderDate(value: string, language: Language) {
  const locales: Record<Language, string> = { es: "es-AR", pt: "pt-BR", en: "en-US", fr: "fr-FR", it: "it-IT", de: "de-DE" };
  return new Intl.DateTimeFormat(locales[language], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function BannerCard({ banner }: { banner: Banner }) {
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
      {banner.imageUrl && <img src={banner.imageUrl} alt="" className="novedad-img" />}
      <div className="novedad-content">
        <div className="novedad-copy">
          <strong>{banner.title}</strong>
          {banner.subtitle && <small>{banner.subtitle}</small>}
        </div>
        <span className="novedad-cta">{banner.ctaLabel} <Icon name="arrow" size={14} /></span>
      </div>
    </a>
  );
}

export default function Home() {
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(DEFAULT_PRODUCTS);
  const [menuSettings, setMenuSettings] = useState<MenuSettings>(DEFAULT_MENU_SETTINGS);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const { foodGroups, foodPreferences, allergenOptions, drinkGroups, beerStyles } = menuSettings;
  const [language, setLanguage] = useState<Language>("es");
  const [langOpen, setLangOpen] = useState(false);
  const [category, setCategory] = useState<"Cocina" | "Cervezas">("Cocina");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedPreferences, setSelectedPreferences] = useState<string[]>([]);
  const [excludedAllergens, setExcludedAllergens] = useState<string[]>([]);
  const [selectedBeerStyles, setSelectedBeerStyles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [selectedServing, setSelectedServing] = useState("Pinta");
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
  const [billRequested, setBillRequested] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [banners, setBanners] = useState<Banner[]>(DEFAULT_BANNERS);
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
    const savedProducts = window.localStorage.getItem(MENU_PRODUCTS_STORAGE_KEY);
    if (savedProducts) {
      try {
        const parsed = JSON.parse(savedProducts) as Product[];
        const hasNewStructure = Array.isArray(parsed) && parsed.some((p) => p.group === "Cervezas clásicas" || p.group === "Tragos clásicos");
        if (hasNewStructure) {
          setCatalogProducts(mergeDefaultProductImages(parsed));
        } else {
          window.localStorage.removeItem(MENU_PRODUCTS_STORAGE_KEY);
        }
      } catch { window.localStorage.removeItem(MENU_PRODUCTS_STORAGE_KEY); }
    }
    const savedSettings = window.localStorage.getItem(MENU_SETTINGS_STORAGE_KEY);
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings) as MenuSettings;
        const hasNewGroups = parsed && Array.isArray(parsed.drinkGroups) && parsed.drinkGroups.includes("Cervezas clásicas");
        if (hasNewGroups) {
          setMenuSettings(parsed);
        } else {
          window.localStorage.removeItem(MENU_SETTINGS_STORAGE_KEY);
        }
      } catch { window.localStorage.removeItem(MENU_SETTINGS_STORAGE_KEY); }
    }
    let loadedAppSettings = DEFAULT_APP_SETTINGS;
    const savedAppSettings = window.localStorage.getItem(ADMIN_APP_SETTINGS_KEY);
    if (savedAppSettings) {
      try {
        const parsed = JSON.parse(savedAppSettings) as AppSettings;
        // Migrate any old golden/amber accent to celeste
        const goldenAccents = ["#c8930a","#c85c0a","#9a8040","#c9a800","#ea8215","#f5c800","#f7d430"];
        if (goldenAccents.includes(parsed.accentColor?.toLowerCase())) parsed.accentColor = "#3a9ad9";
        loadedAppSettings = { ...DEFAULT_APP_SETTINGS, ...parsed };
        setAppSettings(loadedAppSettings);
      } catch { window.localStorage.removeItem(ADMIN_APP_SETTINGS_KEY); }
    }
    const saved = window.localStorage.getItem("restaurant-template-favorites");
    if (saved) {
      try { setFavorites(JSON.parse(saved)); } catch { window.localStorage.removeItem("restaurant-template-favorites"); }
    }
    const savedLanguage = window.localStorage.getItem("restaurant-template-language") as Language | null;
    if (savedLanguage && languageOptions.some((option) => option.code === savedLanguage)) setLanguage(savedLanguage);
    else if (languageOptions.some((option) => option.code === loadedAppSettings.defaultLanguage)) setLanguage(loadedAppSettings.defaultLanguage as Language);
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
    const savedHistory = window.localStorage.getItem("restaurant-template-order-history-v1");
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory) as LaunchedOrder[];
        if (Array.isArray(parsed)) setLaunchedOrders(parsed.map((order) => ({ ...order, tableNumber: order.tableNumber ?? "" })));
      } catch { window.localStorage.removeItem("restaurant-template-order-history-v1"); }
    }
    const savedBanners = window.localStorage.getItem(BANNERS_STORAGE_KEY);
    if (savedBanners) {
      try {
        const parsed = JSON.parse(savedBanners) as Banner[];
        const hasNew = Array.isArray(parsed) && parsed.some((b) => b.id === "cerveza-nueva-seasonal" || b.imageUrl?.includes(".svg"));
        if (hasNew) {
          setBanners(parsed);
        } else {
          window.localStorage.removeItem(BANNERS_STORAGE_KEY);
        }
      } catch { window.localStorage.removeItem(BANNERS_STORAGE_KEY); }
    }
    setOrderHydrated(true);
    trackEvent("session_start");
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => registration.update()).catch(() => undefined);
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
    function syncAdminChanges(event: StorageEvent) {
      if (event.key === MENU_PRODUCTS_STORAGE_KEY && event.newValue) {
        try { setCatalogProducts(JSON.parse(event.newValue) as Product[]); } catch { /* Ignore malformed external data. */ }
      }
      if (event.key === MENU_SETTINGS_STORAGE_KEY && event.newValue) {
        try { setMenuSettings(JSON.parse(event.newValue) as MenuSettings); } catch { /* Ignore malformed external data. */ }
      }
      if (event.key === ADMIN_APP_SETTINGS_KEY && event.newValue) {
        try { setAppSettings({ ...DEFAULT_APP_SETTINGS, ...JSON.parse(event.newValue) as AppSettings }); } catch { /* Ignore malformed external data. */ }
      }
      if (event.key === BANNERS_STORAGE_KEY && event.newValue) {
        try { setBanners(JSON.parse(event.newValue) as Banner[]); } catch { /* Ignore malformed external data. */ }
      }
    }
    window.addEventListener("storage", syncAdminChanges);
    return () => window.removeEventListener("storage", syncAdminChanges);
  }, []);

  const brandName = appSettings.businessName.trim() || DEFAULT_APP_SETTINGS.businessName;
  const logoUrl = appSettings.logoUrl.trim() || DEFAULT_APP_SETTINGS.logoUrl;
  const heroImageUrl = appSettings.heroImageUrl.trim() || DEFAULT_APP_SETTINGS.heroImageUrl;
  const displayPrice = (value: number) => formatPrice(value, appSettings.currency);

  const visibleProducts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    return catalogProducts.filter((product) => {
      const matchesCategory = category === "Cervezas"
        ? product.category === "Cervezas" || product.category === "Bebidas"
        : product.category === "Cocina";
      const content = `${product.name} ${product.description} ${product.tag}`.toLocaleLowerCase("es");
      const matchesGroup = selectedGroups.length === 0 || selectedGroups.includes(product.group);
      const matchesPreferences = selectedPreferences.every((preference) => product.attributes.includes(preference));
      const avoidsAllergens = excludedAllergens.every((allergen) => !product.allergens.includes(allergen));
      const matchesBeerStyle = selectedBeerStyles.length === 0 || (product.beerStyle ? selectedBeerStyles.includes(product.beerStyle) : false);
      return matchesCategory && matchesGroup && matchesPreferences && avoidsAllergens && matchesBeerStyle && (!term || content.includes(term));
    });
  }, [catalogProducts, category, excludedAllergens, query, selectedBeerStyles, selectedGroups, selectedPreferences]);

  const relatedProducts = selected
    ? selected.relatedIds
        .map((id) => catalogProducts.find((product) => product.id === id))
        .filter((product): product is Product => Boolean(product))
    : [];

  const selectedServingOption = selected?.servings?.find((serving) => serving.label === selectedServing);
  const selectedPrice = selectedServingOption?.price ?? selected?.price ?? 0;
  const orderCount = orderItems.reduce((total, item) => total + item.quantity, 0);
  const orderTotal = orderItems.reduce((total, item) => total + (item.unitPrice * item.quantity), 0);
  const launchedTotal = launchedOrders.reduce((total, order) => total + order.total, 0);
  const tr = (text: string) => translate(language, text);

  function toggleListValue(value: string, setter: Dispatch<SetStateAction<string[]>>) {
    setter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function changeCategory(next: "Cocina" | "Cervezas") {
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

  function addSelectedToOrder() {
    if (!selected || orderStatus === "sent") return;
    trackEvent("cart_add", { productId: selected.id });
    const key = `${selected.id}:${selectedServingOption?.label ?? "unidad"}`;
    setOrderItems((current) => {
      const existing = current.find((item) => item.key === key);
      if (existing) return current.map((item) => item.key === key ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, {
        key,
        productId: selected.id,
        name: selected.name,
        image: selected.image,
        serving: selectedServingOption?.label,
        volume: selectedServingOption?.volume,
        unitPrice: selectedPrice,
        quantity: 1,
      }];
    });
    setOrderStatus("draft");
    setOrderFeedback(`${selected.name} · ${selectedServingOption?.label ?? "1 unidad"}`);
  }

  function changeOrderQuantity(key: string, change: number) {
    if (orderStatus === "sent") return;
    setOrderItems((current) => current
      .map((item) => item.key === key ? { ...item, quantity: item.quantity + change } : item)
      .filter((item) => item.quantity > 0));
  }

  const isOnPremise = !appSettings.orderToken || urlToken === appSettings.orderToken;

  function launchOrder() {
    if (!orderItems.length || orderStatus !== "draft") return;
    setTableDraft(tableNumber);
    setTablePromptOpen(true);
  }

  function confirmLaunchOrder(event: FormEvent) {
    event.preventDefault();
    trackEvent("cart_send");
    const confirmedTable = tableDraft.trim();
    if (!/^\d{1,3}$/.test(confirmedTable)) return;
    const id = `R${Date.now().toString().slice(-6)}`;
    const record: LaunchedOrder = { id, launchedAt: new Date().toISOString(), items: orderItems, total: orderTotal, tableNumber: confirmedTable, status: "En preparación" };
    setLaunchedOrders((current) => [record, ...current].slice(0, 30));
    setTableNumber(confirmedTable);
    setBillRequested(false);
    setOrderItems([]);
    setOrderStatus("idle");
    setActiveOrderId(null);
    setTablePromptOpen(false);
    setOrderOpen(false);
    setOrderFeedback("");
  }

  function requestBill() {
    if (!launchedOrders.length || !tableNumber) return;
    trackEvent("bill_request");
    setLaunchedOrders((current) => current.map((order) => ({ ...order, status: "Cuenta solicitada" })));
    setBillRequested(true);
    setHistoryOpen(true);
  }

  function settleBill() {
    if (!window.confirm("¿Confirmar que la cuenta fue cobrada? En producción esta acción la realizará el personal del local.")) return;
    setOrderItems([]);
    setLaunchedOrders([]);
    setOrderStatus("idle");
    setActiveOrderId(null);
    setTableNumber("");
    setTableDraft("");
    setBillRequested(false);
    setOrderOpen(false);
    setHistoryOpen(false);
    setOrderFeedback("");
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
    <main className={orderItems.length ? "site-shell has-active-order" : "site-shell"} style={{ "--yellow": appSettings.accentColor } as CSSProperties}>
      <div className="bg-wave bg-wave-1" aria-hidden="true"/>
      <div className="bg-wave bg-wave-2" aria-hidden="true"/>
      <div className="bg-wave bg-wave-3" aria-hidden="true"/>
      {/* Luces de guirnalda: caen desde las esquinas superiores en diagonal */}
      <div className="string-lights-overlay" aria-hidden="true">
        {/* SVG mobile: paths diseñados para proporciones de teléfono */}
        <svg className="lights-mobile" viewBox="0 0 390 450" preserveAspectRatio="xMidYMin slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="glow-m">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <path d="M 185,0 C 185,150 60,280 0,380" stroke="rgba(30,12,3,0.65)" strokeWidth="2" fill="none" strokeLinecap="round"/>
          <path d="M 205,0 C 205,150 330,280 390,380" stroke="rgba(30,12,3,0.65)" strokeWidth="2" fill="none" strokeLinecap="round"/>
          {[[177,66],[156,129],[126,189],[91,246],[54,300],[20,349]].map(([x,y],i) => (
            <g key={`bml-${i}`}>
              <circle cx={x} cy={y-4} r="3" fill="rgba(20,8,2,0.8)"/>
              <circle cx={x} cy={y+7} r="8" fill="#f5e060" filter="url(#glow-m)" opacity="0.95"/>
              <circle cx={x} cy={y+7} r="8" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1"/>
            </g>
          ))}
          {[[213,66],[234,129],[264,189],[299,246],[336,300],[370,349]].map(([x,y],i) => (
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
          <span className="lang-picker-label">Idioma</span>
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
            <h1>{appSettings.heroTitle} <em>{appSettings.heroHighlight}</em></h1>
            <p className="hero-tagline">{appSettings.heroDescription}</p>
            <div className="hero-actions">
              <a href="#carta" className="primary-button">{tr("Ver la carta")} <Icon name="arrow" size={18}/></a>
            </div>
          </div>
        </div>
      </section>

      {banners.filter((b) => b.visible).length > 0 && (
        <section className="novedades-strip">
          {banners.filter((b) => b.visible).map((banner) => (
            <BannerCard key={banner.id} banner={banner} />
          ))}
        </section>
      )}

      <section className="promise-strip">
        <p><strong>{tr("Fotos reales")}</strong><span>{tr("Sin imágenes genéricas")}</span></p>
        <p><strong>Cocina de autor</strong><span>Producto, estación y técnica</span></p>
        <p><strong>{tr("Elegí mejor")}</strong><span>{tr("Con ayuda cuando la necesites")}</span></p>
      </section>

      <section className="menu-section" id="carta">
        <div className="section-heading">
          <div><p className="eyebrow dark">{tr("NUESTRA CARTA")}</p><h2>{tr("Algo para cada momento.")}</h2></div>
          <label className="search-box"><Icon name="search" size={18}/><input type="search" placeholder={tr("Buscar en el menú")} value={query} onChange={(event) => setQuery(event.target.value)} aria-label={tr("Buscar en el menú")}/></label>
        </div>

        <div className="menu-layout">
          <aside className="vertical-filters" aria-label="Filtros del menú">
            <div className="primary-filter-switch">
              <button className={category === "Cocina" ? "active" : ""} onClick={() => changeCategory("Cocina")} aria-pressed={category === "Cocina"}>{tr("Comida")}</button>
              <button className={category === "Cervezas" ? "active" : ""} onClick={() => changeCategory("Cervezas")} aria-pressed={category === "Cervezas"}>{tr("Bebida")}</button>
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

            {(selectedGroups.length + selectedPreferences.length + excludedAllergens.length + selectedBeerStyles.length) > 0 && <button className="clear-sidebar" onClick={clearSidebarFilters}>{tr("Limpiar filtros")}</button>}
            <p className="filter-demo-note">Datos demostrativos hasta validar la carta.</p>
          </aside>

          <div className="menu-results">
            <div className="results-summary"><strong>{tr(category === "Cocina" ? "Comida" : "Bebida")}</strong><span>{visibleProducts.length} {tr(visibleProducts.length === 1 ? "resultado" : "resultados")}</span></div>
            <div className="photo-note"><Icon name="expand" size={18}/><p><strong>{tr("Tocá una foto para verla completa.")}</strong><span>{tr("Mostramos el producto real, en primer plano y sin sorpresas.")}</span></p></div>

            {visibleProducts.length ? <div className="product-grid">
              {Object.entries(
                visibleProducts.reduce<Record<string, typeof visibleProducts>>((acc, p) => { (acc[p.group] ??= []).push(p); return acc; }, {})
              ).map(([group, groupProducts]) => (
                <Fragment key={group}>
                  <div className="product-group-header"><h3>{tr(group)}</h3></div>
                  {groupProducts.map((product) => (
                    <article className="product-card" key={product.id} data-style={product.beerStyle?.toLowerCase().replace(/\s+/g, "-")}>
                      <button className="product-visual" onClick={() => setSelected(product)} aria-label={`${tr("Ver detalle")} ${tr(product.name)}`}>
                        {product.image ? <img className={product.id === "filet-numa" ? "filet-numa-image" : undefined} src={product.image} alt={`${tr(product.name)} · ${brandName}`} /> : <span className="photo-pending"><Icon name="expand" size={20}/><strong>{tr("Foto real pendiente")}</strong></span>}
                        <span className="product-tag">{product.tag}</span>
                        <span className="expand-label"><Icon name="expand" size={14}/> {tr("Ver detalle")}</span>
                      </button>
                      <div className="product-info">
                        <p className="product-category">{tr(product.group)}{product.beerStyle ? ` · ${tr(product.beerStyle)}` : ""}</p>
                        <div className="product-title"><button onClick={() => setSelected(product)}><h3>{tr(product.name)}</h3></button><button className={favorites.includes(product.id) ? "favorite active" : "favorite"} onClick={() => toggleFavorite(product.id)} aria-label={`Guardar ${tr(product.name)}`}><Icon name="heart" size={18}/></button></div>
                        <p>{tr(product.description)}</p>
                        <div className="product-footer"><span><small>{tr(product.servings ? "Desde" : "Precio demo")}</small><strong>{displayPrice(product.servings ? Math.min(...product.servings.map((serving) => serving.price)) : product.price)}</strong></span><button onClick={() => setSelected(product)}>{tr("Ver detalle")} <Icon name="arrow" size={15}/></button></div>
                      </div>
                    </article>
                  ))}
                </Fragment>
              ))}
            </div> : <div className="empty-state"><h3>No hay resultados con esos filtros</h3><p>Probá desmarcar una opción o limpiar los filtros.</p><button onClick={clearSidebarFilters}>Limpiar filtros</button></div>}
          </div>
        </div>
      </section>

      <section className="events-banner">
        <div className="events-banner-poster"><img src={events[0].image} alt={`Cena especial en ${brandName}`}/><span>{events[0].date}</span></div>
        <div className="events-banner-copy"><p className="eyebrow">EXPERIENCIAS EN {brandName.toLocaleUpperCase("es")}</p><h2>La mesa también es un encuentro.</h2><p>Cenas especiales, degustaciones y propuestas de temporada para descubrir la cocina de otra manera.</p><div><span>EVENTO DESTACADO</span><strong>{events[0].title} · {events[0].time}</strong></div></div>
        <button onClick={() => { setEventsOpen(true); trackEvent("events_open"); }}>{tr("Ver eventos")} <Icon name="arrow" size={18}/></button>
      </section>

      <footer><img src={logoUrl} alt={brandName}/><p>{brandName} · {appSettings.brandTagline} · La mesa se confirma al lanzar el pedido.</p></footer>

      {eventsOpen && <div className="overlay" onMouseDown={() => setEventsOpen(false)}>
        <section className="events-panel" role="dialog" aria-modal="true" aria-labelledby="events-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className="events-panel-header"><div><p>AGENDA · {brandName.toLocaleUpperCase("es")}</p><h2 id="events-title">{tr("Agenda de eventos")}</h2><span>Conocé las próximas experiencias del restaurante.</span></div><button onClick={() => setEventsOpen(false)} aria-label="Cerrar agenda"><Icon name="close"/></button></header>
          <div className="events-list">
            {events.map((event) => <article key={event.id}>
              <div className="event-poster"><img src={event.image} alt={`Flyer de ${event.title}`}/></div>
              <div className="event-information">
                <div className="event-date-line"><span><b>{event.date}</b>{event.time}</span><small>{event.place}</small></div>
                <p>EVENTO DESTACADO</p><h3>{event.title}</h3><strong className="event-admission">{tr(event.admission)}</strong><p className="event-description">{event.description}</p>
                <div className="event-highlights">{event.highlights.map((highlight) => <span key={highlight}>• {highlight}</span>)}</div>
              </div>
            </article>)}
            <div className="events-coming-soon"><span>＋</span><div><strong>{tr("Más eventos próximamente")}</strong><p>{tr("La agenda está preparada para incorporar todas las fechas de cada mes.")}</p></div></div>
          </div>
        </section>
      </div>}

      {orderItems.length > 0 && <button className={orderStatus === "sent" ? "order-status-bar sent" : "order-status-bar"} onClick={() => setOrderOpen(true)} aria-label="Abrir carrito">
        <span className="order-status-icon"><Icon name={orderStatus === "sent" ? "receipt" : "plus"} size={20}/><b>{orderCount}</b></span>
        <span><small>{tr(orderStatus === "sent" ? "PEDIDO LANZADO" : "CARRITO ABIERTO")}</small><strong>{tr(orderStatus === "sent" ? "Ver estado del pedido" : "Revisar carrito")}</strong></span>
        <span className="order-status-total">{displayPrice(orderTotal)}<Icon name="arrow" size={17}/></span>
      </button>}

      {orderOpen && <div className="overlay" onMouseDown={() => setOrderOpen(false)}>
        <section className="order-panel" role="dialog" aria-modal="true" aria-labelledby="order-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className="order-panel-header">
            <div><p>{tr(orderStatus === "sent" ? "PEDIDO LANZADO" : "CARRITO ABIERTO")}</p><h2 id="order-title">{tr(orderStatus === "sent" ? "Tu pedido está en marcha" : "Revisá antes de lanzarlo")}</h2></div>
            <button onClick={() => setOrderOpen(false)} aria-label="Cerrar resumen"><Icon name="close"/></button>
          </header>
          {orderStatus === "draft" && <div className="cart-open-message"><strong>{tr("El pedido todavía no fue lanzado.")}</strong><span>{tr("Podés seguir agregando productos o cerrar el carrito cuando esté completo.")}</span></div>}
          {orderStatus === "sent" && <div className="order-sent-message"><span><Icon name="receipt" size={23}/></span><div><strong>{tr("Pedido enviado correctamente")}</strong><p>Esta es una simulación. La confirmación real se conectará con el sistema del local y la mesa.</p></div></div>}
          <div className="order-items">
            {orderItems.map((item) => <article key={item.key}>
              {item.image ? <img src={item.image} alt=""/> : <span className="order-item-placeholder"/>}
              <div className="order-item-copy"><strong>{tr(item.name)}</strong>{item.serving && <small>{tr(item.serving)} · {item.volume}</small>}<b>{displayPrice(item.unitPrice)}</b></div>
              <div className="quantity-control" aria-label={`Cantidad de ${item.name}`}>
                <button onClick={() => changeOrderQuantity(item.key, -1)} disabled={orderStatus === "sent"} aria-label={`Quitar una unidad de ${item.name}`}>−</button>
                <span>{item.quantity}</span>
                <button onClick={() => changeOrderQuantity(item.key, 1)} disabled={orderStatus === "sent"} aria-label={`Agregar una unidad de ${item.name}`}>+</button>
              </div>
            </article>)}
          </div>
          <div className="order-total"><span><small>{orderCount} {tr(orderCount === 1 ? "producto" : "productos")}</small><strong>{tr("Total")}</strong></span><b>{displayPrice(orderTotal)}</b></div>
          {orderStatus === "draft" ? (
            isOnPremise
              ? <button className="launch-order" onClick={launchOrder}><Icon name="arrow" size={19}/> {tr("Cerrar carrito y lanzar pedido")}</button>
              : <div className="order-blocked"><span>🔒</span><p>El pedido solo se puede lanzar desde adentro de la cervecería. Escaneá el QR de tu mesa para habilitarlo.</p></div>
          ) : <button className="close-order" onClick={requestBill}>{tr("Solicitar la cuenta")}</button>}
          <p className="order-panel-note">Antes de lanzar el pedido te pediremos confirmar el número de mesa.</p>
        </section>
      </div>}

      {tablePromptOpen && <div className="overlay" onMouseDown={() => setTablePromptOpen(false)}>
        <section className="table-dialog" role="dialog" aria-modal="true" aria-labelledby="table-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
          <button className="modal-close light" onClick={() => setTablePromptOpen(false)} aria-label="Cerrar"><Icon name="close"/></button>
          <span className="table-dialog-number">{tableDraft || "—"}</span>
          <p className="eyebrow">IDENTIFICAR PEDIDO</p>
          <h2 id="table-dialog-title">¿Cuál es tu número de mesa?</h2>
          <p>Lo necesitamos para que el personal reciba el pedido en el lugar correcto.</p>
          <form onSubmit={confirmLaunchOrder}>
            <label>Mesa número<input type="text" inputMode="numeric" pattern="[0-9]{1,3}" maxLength={3} value={tableDraft} onChange={(event) => setTableDraft(event.target.value.replace(/\D/g, ""))} readOnly={launchedOrders.length > 0} autoFocus aria-label="Número de mesa"/></label>
            {launchedOrders.length > 0 && <small>La mesa queda fijada durante esta cuenta. Se libera después del cobro.</small>}
            <button type="submit" disabled={!/^\d{1,3}$/.test(tableDraft) || !isOnPremise}>Confirmar mesa y lanzar pedido</button>
          </form>
        </section>
      </div>}

      {historyOpen && <div className="overlay" onMouseDown={() => setHistoryOpen(false)}>
        <section className="history-panel" role="dialog" aria-modal="true" aria-labelledby="history-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className="order-panel-header">
            <div><p>{tr("HISTORIAL LOCAL")}</p><h2 id="history-title">{tr("Mis pedidos")}</h2></div>
            <button onClick={() => setHistoryOpen(false)} aria-label="Cerrar historial"><Icon name="close"/></button>
          </header>
          {launchedOrders.length ? <><div className={billRequested ? "history-bill-summary requested" : "history-bill-summary"}><div><small>CUENTA DE LA MESA</small><strong>Mesa {tableNumber || launchedOrders[0]?.tableNumber}</strong><span>{launchedOrders.length} {launchedOrders.length === 1 ? "pedido lanzado" : "pedidos lanzados"}</span></div><b>{displayPrice(launchedTotal)}</b></div><div className="launched-orders">
            {launchedOrders.map((order) => <article key={order.id}>
              <header><div><strong>Pedido #{order.id} · Mesa {order.tableNumber || tableNumber}</strong><time dateTime={order.launchedAt}>{formatOrderDate(order.launchedAt, language)}</time></div><span className={order.status === "Cerrado" ? "closed" : order.status === "Cuenta solicitada" ? "requested" : ""}>{tr(order.status)}</span></header>
              <div className="launched-order-items">{order.items.map((item) => <p key={item.key}><span><b>{item.quantity}×</b> {tr(item.name)}{item.serving ? ` · ${tr(item.serving)} (${item.volume})` : ""}</span><strong>{displayPrice(item.unitPrice * item.quantity)}</strong></p>)}</div>
              <div className="launched-order-total"><span>{order.items.reduce((total, item) => total + item.quantity, 0)} {tr("productos")}</span><strong>{displayPrice(order.total)}</strong></div>
            </article>)}
          </div><div className="history-account-actions">{!billRequested && <button className="request-bill-history" onClick={requestBill}>Solicitar la cuenta · {displayPrice(launchedTotal)}</button>}<button className="provisional-paid-button" onClick={settleBill}><small>ACCIÓN PROVISIONAL</small><strong>✓ Cuenta cobrada</strong><span>Reiniciar mesa y carrito</span></button></div></> : <div className="history-empty"><span><Icon name="receipt" size={28}/></span><h3>{tr("Todavía no lanzaste pedidos")}</h3><p>Cuando cierres un carrito y lo lances, aparecerá acá con su estado y detalle completo.</p></div>}
          <p className="order-panel-note">Al confirmarse el cobro, los pedidos desaparecen y la mesa queda libre para una nueva cuenta.</p>
        </section>
      </div>}

      {selected && <div className="overlay" onMouseDown={() => setSelected(null)}>
        <article className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="product-title" data-style={selected.beerStyle?.toLowerCase().replace(/\s+/g, "-")} onMouseDown={(event) => event.stopPropagation()}>
          <button className="modal-close" onClick={() => setSelected(null)} aria-label="Cerrar"><Icon name="close"/></button>
          <div className="detail-image">{selected.image ? <img className={selected.id === "filet-numa" ? "filet-numa-image" : undefined} src={selected.image} alt={`${selected.name} de ${brandName}, vista ampliada`}/> : <div className="detail-photo-pending"><Icon name="expand" size={28}/><strong>Fotografía real pendiente</strong><small>Este espacio se reemplazará por la imagen real del restaurante.</small></div>}<span>{selected.image ? "FOTO DEL PRODUCTO" : "RECURSO PENDIENTE"}</span></div>
          <div className="detail-copy">
            <p className="product-category">{tr(selected.category === "Cocina" ? "Comida" : "Bebida")}</p>
            <h2 id="product-title">{tr(selected.name)}</h2>
            {selected.beerProfile && <section className="beer-profile" aria-label={`Características de ${selected.name}`}>
              {selected.beerStyle && <p className="beer-style-badge">{selected.beerStyle.toUpperCase()}</p>}
              <div className="beer-descriptors">{selected.beerProfile.descriptors.map((descriptor) => <span key={descriptor}>{tr(descriptor)}</span>)}</div>
              <div className="beer-metrics">
                <div className="beer-metrics-header"><span>DATOS TÉCNICOS</span></div>
                <span>
                  <span className="beer-metric-info"><em>ALCOHOL %</em><small>Contenido alcohólico por volumen</small></span>
                  <strong>{selected.beerProfile.abv}</strong>
                </span>
                <span>
                  <span className="beer-metric-info"><em>COLOR EBC</em><small>Escala europea de color — mayor valor, más oscura</small></span>
                  <strong>{selected.beerProfile.srm}</strong>
                </span>
                <span>
                  <span className="beer-metric-info"><em>AMARGO IBU</em><small>Unidades de amargor — mayor valor, más amarga</small></span>
                  <strong>{selected.beerProfile.ibu}</strong>
                </span>
              </div>
            </section>}
            <p>{tr(selected.description)}</p>

            {selected.servings ? <section className="serving-selector" aria-labelledby="serving-title">
              <div className="detail-section-heading"><div><p>{tr("FORMATO")}</p><h3 id="serving-title">{tr("¿Cómo la querés?")}</h3></div><small>{tr("Precios de muestra")}</small></div>
              <div className="serving-options">
                {selected.servings.map((serving) => <button key={serving.label} className={selectedServing === serving.label ? "active" : ""} onClick={() => { setSelectedServing(serving.label); setOrderFeedback(""); }} aria-pressed={selectedServing === serving.label}>
                  <span><strong>{tr(serving.label)}</strong><small>{serving.volume}</small></span>
                  <b>{displayPrice(serving.price)}</b>
                </button>)}
              </div>
            </section> : <div className="single-price"><span>{tr("Precios de muestra")}</span><strong>{displayPrice(selected.price)}</strong></div>}

            <section className="nutrition-card" aria-labelledby="nutrition-title">
              <div className="detail-section-heading"><div><p>{tr("INFORMACIÓN NUTRICIONAL")}</p><h3 id="nutrition-title">{tr("Valores nutricionales")}</h3></div><small>{tr(selected.nutrition.basis)}</small></div>
              <dl>
                <div><dt>{tr("Calorías")}</dt><dd>{selected.nutrition.calories}</dd></div>
                <div><dt>{tr("Grasas")}</dt><dd>{selected.nutrition.fats}</dd></div>
                <div><dt>{tr("Proteínas")}</dt><dd>{selected.nutrition.proteins}</dd></div>
                <div><dt>{tr("Carbohidratos")}</dt><dd>{selected.nutrition.carbs}</dd></div>
                <div><dt>{tr("Azúcares")}</dt><dd>{selected.nutrition.sugars}</dd></div>
              </dl>
              <div className="allergen-summary"><strong>{tr("Alérgenos")}</strong><div>{selected.allergens.length ? selected.allergens.map((allergen) => <span className="allergen-item" key={allergen}><i aria-hidden="true">{allergenIcons[allergen] ?? "•"}</i>{tr(allergen)}</span>) : <span className="allergen-item allergen-free"><i aria-hidden="true">✓</i>Sin alérgenos declarados</span>}</div></div>
            </section>
            <div className="validation-note"><strong>{tr("Información provisional")}</strong><span>{language === "es" ? selected.note : tr("Información pendiente de validación con la carta oficial.")} {tr("Los precios y valores nutricionales mostrados son demostrativos.")}</span></div>
            <button className={orderStatus === "sent" ? "order-button locked" : orderFeedback ? "order-button added" : "order-button"} onClick={addSelectedToOrder} disabled={orderStatus === "sent"}><Icon name={orderStatus === "sent" || orderFeedback ? "receipt" : "plus"} size={19}/><span>{orderStatus === "sent" ? tr("PEDIDO LANZADO") : orderFeedback ? tr("Agregado al carrito") : <>{tr("Agregar al carrito")} · {displayPrice(selectedPrice)}</>}</span></button>
            {orderFeedback && <p className="order-feedback">{tr(selected.name)} · {selectedServingOption ? tr(selectedServingOption.label) : "1"}<small>Pedido de demostración. La vinculación con la mesa se activará más adelante.</small></p>}
            <section className="cross-sell" aria-labelledby="cross-sell-title">
              <p>{tr("PARA COMPLETAR TU ELECCIÓN")}</p>
              <h3 id="cross-sell-title">{tr("Se puede acompañar con")}</h3>
              <div className="cross-sell-grid">
                {relatedProducts.map((product) => <button key={product.id} onClick={() => { trackEvent("crosssell_click", { productId: selected.id, relatedProductId: product.id }); setSelected(product); }}>
                  {product.image ? <img src={product.image} alt=""/> : <span className="cross-sell-placeholder"><Icon name="expand" size={16}/></span>}
                  <span><strong>{tr(product.name)}</strong><small>{tr(product.group)}{product.beerStyle ? ` · ${tr(product.beerStyle)}` : ""}</small></span>
                  <Icon name="arrow" size={16}/>
                </button>)}
              </div>
            </section>
            <button className={favorites.includes(selected.id) ? "save-button active" : "save-button"} onClick={() => toggleFavorite(selected.id)}><Icon name="heart" size={18}/>{tr(favorites.includes(selected.id) ? "Guardado en favoritos" : "Guardar para decidir después")}</button>
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
  );
}
