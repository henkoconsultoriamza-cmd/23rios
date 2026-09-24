"use client";

import { ChangeEvent, CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ADMIN_APP_SETTINGS_KEY,
  AppSettings,
  cloneDefaultProducts,
  cloneDefaultSettings,
  DEFAULT_APP_SETTINGS,
  MENU_PRODUCTS_STORAGE_KEY,
  MENU_SETTINGS_STORAGE_KEY,
  MenuSettings,
  Product,
  mergeDefaultProductImages,
  Promo,
  PROMOS_STORAGE_KEY,
  isPromoActive,
} from "../menu-data";
import {
  cloneDefaultPortalSettings,
  PORTAL_SETTINGS_STORAGE_KEY,
  PortalAction,
  PortalSettings,
} from "../portal-data";
import { AnalyticsEvent, ANALYTICS_STORAGE_KEY, clearStoredEvents, getStoredEvents } from "../analytics";
import { Banner, BANNERS_STORAGE_KEY } from "../banner-data";

type SettingsKey = keyof MenuSettings;
type AdminTab = "products" | "filters" | "portal" | "adjustments" | "analytics" | "banners" | "evento";
type DateRange = "today" | "7d" | "30d" | "all";
type AdminCredentials = { username: string; passwordHash: string };

const ADMIN_SESSION_KEY = "restaurant-template-admin-session-v1";
const ADMIN_CREDENTIALS_KEY = "restaurant-template-admin-credentials-v1";
const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "menu2026";

const settingsSections: { key: SettingsKey; title: string; description: string }[] = [
  { key: "foodGroups", title: "Tipos de comida", description: "Organizan los platos dentro del filtro Comida." },
  { key: "foodPreferences", title: "Preferencias", description: "Por ejemplo: vegetariano, sin TACC o para compartir." },
  { key: "allergenOptions", title: "Alérgenos", description: "Información que el cliente puede excluir antes de elegir." },
  { key: "drinkGroups", title: "Tipos de bebida", description: "Gaseosas, aguas, cervezas y nuevas familias de bebidas." },
  { key: "beerStyles", title: "Estilos de cerveza", description: "Clasificación visible al elegir cerveza." },
];

function createEmptyProduct(category: Product["category"], settings: MenuSettings): Product {
  const isBeer = category === "Cervezas";
  return {
    id: "",
    name: "",
    category,
    description: "",
    image: "",
    tag: isBeer ? "Bebida" : "Nuevo plato",
    note: "Información pendiente de validación.",
    group: isBeer ? settings.drinkGroups[0] ?? "Bebidas" : settings.foodGroups[0] ?? "Comidas",
    attributes: [],
    allergens: [],
    relatedIds: [],
    price: 0,
    nutrition: { basis: "Por porción", calories: "", fats: "", proteins: "", carbs: "", sugars: "" },
  };
}

function formatPrice(value: number) {
  return `$ ${Number(value || 0).toLocaleString("es-AR")}`;
}

function slugify(value: string) {
  return value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "producto";
}

async function hashPassword(value: string) {
  const bytes = new TextEncoder().encode(`restaurant-template-admin:${value}`);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("products");
  const [authenticated, setAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [hasCustomCredentials, setHasCustomCredentials] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [portalSettings, setPortalSettings] = useState<PortalSettings>(() => cloneDefaultPortalSettings());
  const [securityUsername, setSecurityUsername] = useState(DEFAULT_ADMIN_USERNAME);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [products, setProducts] = useState<Product[]>(() => cloneDefaultProducts());
  const [settings, setSettings] = useState<MenuSettings>(() => cloneDefaultSettings());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Product>(() => createEmptyProduct("Cocina", cloneDefaultSettings()));
  const [isNew, setIsNew] = useState(true);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"Todos" | Product["category"]>("Todos");
  const [newOptions, setNewOptions] = useState<Partial<Record<SettingsKey, string>>>({});
  const [notice, setNotice] = useState("Cambios guardados solamente en este dispositivo.");
  const [hydrated, setHydrated] = useState(false);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [bannerDraft, setBannerDraft] = useState<Banner | null>(null);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [promoDraft, setPromoDraft] = useState<Promo | null>(null);
  const [analyticsEvents, setAnalyticsEvents] = useState<AnalyticsEvent[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>("7d");

  useEffect(() => {
    let loadedProducts = cloneDefaultProducts();
    let loadedSettings = cloneDefaultSettings();
    const storedProducts = window.localStorage.getItem(MENU_PRODUCTS_STORAGE_KEY);
    const storedSettings = window.localStorage.getItem(MENU_SETTINGS_STORAGE_KEY);
    const storedAppSettings = window.localStorage.getItem(ADMIN_APP_SETTINGS_KEY);
    const storedPortalSettings = window.localStorage.getItem(PORTAL_SETTINGS_STORAGE_KEY);
    const storedCredentials = window.localStorage.getItem(ADMIN_CREDENTIALS_KEY);
    if (storedProducts) {
      try {
        const parsed = JSON.parse(storedProducts) as Product[];
        if (Array.isArray(parsed)) loadedProducts = mergeDefaultProductImages(parsed);
      } catch { window.localStorage.removeItem(MENU_PRODUCTS_STORAGE_KEY); }
    }
    if (storedSettings) {
      try {
        const parsed = JSON.parse(storedSettings) as MenuSettings;
        if (parsed && Array.isArray(parsed.foodGroups)) loadedSettings = parsed;
      } catch { window.localStorage.removeItem(MENU_SETTINGS_STORAGE_KEY); }
    }
    if (storedAppSettings) {
      try { setAppSettings({ ...DEFAULT_APP_SETTINGS, ...JSON.parse(storedAppSettings) as AppSettings }); }
      catch { window.localStorage.removeItem(ADMIN_APP_SETTINGS_KEY); }
    }
    if (storedPortalSettings) {
      try {
        const parsed = JSON.parse(storedPortalSettings) as PortalSettings;
        setPortalSettings({ ...cloneDefaultPortalSettings(), ...parsed, actions: Array.isArray(parsed.actions) ? parsed.actions : cloneDefaultPortalSettings().actions });
      } catch { window.localStorage.removeItem(PORTAL_SETTINGS_STORAGE_KEY); }
    }
    if (storedCredentials) {
      try {
        const parsed = JSON.parse(storedCredentials) as AdminCredentials;
        if (parsed.username) {
          setSecurityUsername(parsed.username);
          setHasCustomCredentials(true);
        }
      } catch { window.localStorage.removeItem(ADMIN_CREDENTIALS_KEY); }
    }
    setAuthenticated(window.sessionStorage.getItem(ADMIN_SESSION_KEY) === "active");
    setProducts(loadedProducts);
    setSettings(loadedSettings);
    const storedBanners = window.localStorage.getItem(BANNERS_STORAGE_KEY);
    if (storedBanners) {
      try {
        const parsed = JSON.parse(storedBanners) as Banner[];
        if (Array.isArray(parsed)) setBanners(parsed);
      } catch { window.localStorage.removeItem(BANNERS_STORAGE_KEY); }
    }
    const storedPromos = window.localStorage.getItem(PROMOS_STORAGE_KEY);
    if (storedPromos) {
      try {
        const parsed = JSON.parse(storedPromos) as Promo[];
        if (Array.isArray(parsed)) setPromos(parsed);
      } catch { window.localStorage.removeItem(PROMOS_STORAGE_KEY); }
    }
    setAnalyticsEvents(getStoredEvents());
    if (loadedProducts[0]) {
      setSelectedId(loadedProducts[0].id);
      setDraft(structuredClone(loadedProducts[0]));
      setIsNew(false);
    } else {
      setDraft(createEmptyProduct("Cocina", loadedSettings));
    }
    setHydrated(true);
  }, []);

  const filteredProducts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    return products.filter((product) => (categoryFilter === "Todos" || product.category === categoryFilter) && (!term || `${product.name} ${product.group}`.toLocaleLowerCase("es").includes(term)));
  }, [categoryFilter, products, query]);

  const foodCount = products.filter((product) => product.category === "Cocina").length;
  const drinkCount = products.length - foodCount;

  const analyticsData = useMemo(() => {
    const now = new Date();
    const cutoff =
      dateRange === "today" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      : dateRange === "7d" ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      : dateRange === "30d" ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const filtered = cutoff ? analyticsEvents.filter((e) => e.timestamp >= cutoff) : analyticsEvents;

    const sessions = new Set(filtered.filter((e) => e.type === "session_start").map((e) => e.sessionId)).size;
    const views = filtered.filter((e) => e.type === "product_view");
    const cartAdds = filtered.filter((e) => e.type === "cart_add");
    const cartSends = filtered.filter((e) => e.type === "cart_send");
    const crosssells = filtered.filter((e) => e.type === "crosssell_click");
    const langChanges = filtered.filter((e) => e.type === "language_change");
    const filterUses = filtered.filter((e) => e.type === "filter_use");
    const bannerClicks = filtered.filter((e) => e.type === "banner_click");
    const bannerViewEvents = filtered.filter((e) => e.type === "banner_view");
    const eventsOpens = filtered.filter((e) => e.type === "events_open");
    const assistantOpens = filtered.filter((e) => e.type === "assistant_open");

    const viewCounts: Record<string, number> = {};
    views.forEach((e) => { if (e.productId) viewCounts[e.productId] = (viewCounts[e.productId] ?? 0) + 1; });
    const cartAddCounts: Record<string, number> = {};
    cartAdds.forEach((e) => { if (e.productId) cartAddCounts[e.productId] = (cartAddCounts[e.productId] ?? 0) + 1; });
    const topProducts = Object.entries(viewCounts)
      .map(([id, v]) => ({ id, views: v, cartAdds: cartAddCounts[id] ?? 0 }))
      .sort((a, b) => b.views - a.views).slice(0, 8);

    const pairCounts: Record<string, number> = {};
    crosssells.forEach((e) => {
      if (e.productId && e.relatedProductId) {
        const key = `${e.productId}→${e.relatedProductId}`;
        pairCounts[key] = (pairCounts[key] ?? 0) + 1;
      }
    });
    const topPairs = Object.entries(pairCounts).map(([pair, count]) => ({ pair, count })).sort((a, b) => b.count - a.count).slice(0, 5);

    const langCounts: Record<string, number> = {};
    langChanges.forEach((e) => { if (e.language) langCounts[e.language] = (langCounts[e.language] ?? 0) + 1; });

    const filterCounts: Record<string, number> = {};
    filterUses.forEach((e) => { if (e.filterName) filterCounts[e.filterName] = (filterCounts[e.filterName] ?? 0) + 1; });
    const topFilters = Object.entries(filterCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const bannerCounts: Record<string, { clicks: number; views: number }> = {};
    bannerClicks.forEach((e) => {
      if (e.bannerId) {
        if (!bannerCounts[e.bannerId]) bannerCounts[e.bannerId] = { clicks: 0, views: 0 };
        bannerCounts[e.bannerId].clicks++;
      }
    });
    bannerViewEvents.forEach((e) => {
      if (e.bannerId) {
        if (!bannerCounts[e.bannerId]) bannerCounts[e.bannerId] = { clicks: 0, views: 0 };
        bannerCounts[e.bannerId].views++;
      }
    });

    const days: { label: string; date: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        date: dateStr,
        count: filtered.filter((e) => e.type === "session_start" && e.timestamp.startsWith(dateStr)).length,
      });
    }

    return {
      filtered,
      sessions,
      viewCount: views.length,
      cartAddCount: cartAdds.length,
      cartSendCount: cartSends.length,
      crosssellCount: crosssells.length,
      eventsOpensCount: eventsOpens.length,
      assistantOpensCount: assistantOpens.length,
      topProducts,
      topPairs,
      langCounts,
      topFilters,
      bannerCounts,
      days,
      viewConversion: views.length > 0 ? Math.round((cartAdds.length / views.length) * 100) : 0,
      sessionConversion: sessions > 0 ? Math.round((cartSends.length / sessions) * 100) : 0,
      maxDayCount: Math.max(...(days.map((d) => d.count)), 1),
    };
  }, [analyticsEvents, dateRange, products]);

  const selectableGroups = draft.category === "Cocina" ? settings.foodGroups : settings.drinkGroups;
  const isCraftBeer = draft.category === "Cervezas" && draft.group === "Cerveza";

  function selectProduct(product: Product) {
    setSelectedId(product.id);
    setDraft(structuredClone(product));
    setIsNew(false);
    setNotice("Editando producto. Guardá para aplicar los cambios.");
  }

  function startNew(category: Product["category"] = "Cocina") {
    setSelectedId(null);
    setDraft(createEmptyProduct(category, settings));
    setIsNew(true);
    setTab("products");
    setNotice("Completá la información del nuevo producto.");
  }

  function updateDraft<K extends keyof Product>(key: K, value: Product[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function toggleDraftList(key: "attributes" | "allergens" | "relatedIds", value: string) {
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value],
    }));
  }

  function persistProducts(next: Product[]) {
    try {
      window.localStorage.setItem(MENU_PRODUCTS_STORAGE_KEY, JSON.stringify(next));
      setProducts(next);
      return true;
    } catch {
      setNotice("No se pudo guardar. La fotografía puede ser demasiado pesada para este prototipo local.");
      return false;
    }
  }

  function saveProduct() {
    if (!draft.name.trim() || !draft.group.trim()) {
      setNotice("Completá el nombre y el tipo antes de guardar.");
      return;
    }
    const baseId = isNew ? slugify(draft.name) : draft.id;
    let id = baseId;
    if (isNew && products.some((product) => product.id === id)) id = `${baseId}-${Date.now().toString().slice(-4)}`;
    const normalized: Product = {
      ...draft,
      id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      price: Math.max(0, Number(draft.price) || 0),
      image: draft.image?.trim() || "",
    };
    const next = isNew ? [normalized, ...products] : products.map((product) => product.id === selectedId ? normalized : product);
    if (!persistProducts(next)) return;
    setDraft(structuredClone(normalized));
    setSelectedId(normalized.id);
    setIsNew(false);
    setNotice("Producto guardado. Ya está disponible en el menú general.");
  }

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);
  const promoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (isNew || !draft.name.trim() || !draft.group.trim() || !hydrated) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      const normalized: Product = {
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        price: Math.max(0, Number(draft.price) || 0),
        image: draft.image?.trim() || "",
      };
      const next = products.map((p) => p.id === selectedId ? normalized : p);
      try {
        window.localStorage.setItem(MENU_PRODUCTS_STORAGE_KEY, JSON.stringify(next));
        setProducts(next);
        setNotice("Guardado automáticamente ✓");
      } catch { /* silencioso */ }
    }, 1200);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [draft]);

  useEffect(() => {
    if (!promoDraft) return;
    if (promoSaveTimer.current) clearTimeout(promoSaveTimer.current);
    promoSaveTimer.current = setTimeout(() => {
      const next = promos.map((p) => p.id === promoDraft.id ? promoDraft : p);
      try { window.localStorage.setItem(PROMOS_STORAGE_KEY, JSON.stringify(next)); setPromos(next); setNotice("Promoción guardada automáticamente ✓"); } catch { /* silencioso */ }
    }, 1000);
    return () => { if (promoSaveTimer.current) clearTimeout(promoSaveTimer.current); };
  }, [promoDraft]);

  useEffect(() => {
    if (!bannerDraft) return;
    if (bannerSaveTimer.current) clearTimeout(bannerSaveTimer.current);
    bannerSaveTimer.current = setTimeout(() => {
      const next = banners.map((b) => b.id === bannerDraft.id ? bannerDraft : b);
      try { window.localStorage.setItem(BANNERS_STORAGE_KEY, JSON.stringify(next)); setBanners(next); setNotice("Novedad guardada automáticamente ✓"); } catch { /* silencioso */ }
    }, 1000);
    return () => { if (bannerSaveTimer.current) clearTimeout(bannerSaveTimer.current); };
  }, [bannerDraft]);

  function deleteProduct() {
    if (isNew || !selectedId) return;
    const current = products.find((product) => product.id === selectedId);
    if (!current || !window.confirm(`¿Eliminar “${current.name}” del menú?`)) return;
    const next = products.filter((product) => product.id !== selectedId).map((product) => ({ ...product, relatedIds: product.relatedIds.filter((id) => id !== selectedId) }));
    if (!persistProducts(next)) return;
    const following = next[0];
    if (following) selectProduct(following); else startNew();
    setNotice("Producto eliminado del menú.");
  }

  function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      setNotice("Para esta demostración, la foto debe pesar menos de 1,5 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        updateDraft("image", reader.result);
        setNotice("Foto cargada. Falta guardar el producto.");
      }
    };
    reader.readAsDataURL(file);
  }

  function updateNutrition(key: keyof Product["nutrition"], value: string) {
    setDraft((current) => ({ ...current, nutrition: { ...current.nutrition, [key]: value } }));
  }

  function ensureBeerProfile() {
    return draft.beerProfile ?? { style: draft.name, descriptors: [], ibu: "", abv: "", srm: "" };
  }

  function updateBeerProfile(key: keyof NonNullable<Product["beerProfile"]>, value: string | string[]) {
    setDraft((current) => ({ ...current, beerProfile: { ...(current.beerProfile ?? { style: current.name, descriptors: [], ibu: "", abv: "", srm: "" }), [key]: value } }));
  }

  function updateServing(label: string, field: "volume" | "price", value: string) {
    const currentServings = draft.servings ?? [
      { label: "Media pinta", volume: "250 cc", price: 0 },
      { label: "Pinta", volume: "500 cc", price: 0 },
      { label: "Jarra", volume: "1 L", price: 0 },
    ];
    setDraft((current) => ({
      ...current,
      servings: currentServings.map((serving) => serving.label === label ? { ...serving, [field]: field === "price" ? Math.max(0, Number(value) || 0) : value } : serving),
    }));
  }

  function changeProductCategory(category: Product["category"]) {
    setDraft((current) => ({
      ...current,
      category,
      group: category === "Cocina" ? settings.foodGroups[0] ?? "Comidas" : settings.drinkGroups[0] ?? "Bebidas",
      beerStyle: category === "Cocina" ? undefined : current.beerStyle,
      beerProfile: category === "Cocina" ? undefined : current.beerProfile,
      servings: category === "Cocina" ? undefined : current.servings,
    }));
  }

  function changeProductGroup(group: string) {
    setDraft((current) => {
      if (current.category === "Cervezas" && group === "Cerveza") {
        return {
          ...current,
          group,
          beerProfile: current.beerProfile ?? { style: current.name, descriptors: [], ibu: "", abv: "", srm: "" },
          servings: current.servings ?? [
            { label: "Media pinta", volume: "250 cc", price: current.price },
            { label: "Pinta", volume: "500 cc", price: current.price },
            { label: "Jarra", volume: "1 L", price: current.price },
          ],
        };
      }
      return { ...current, group, beerStyle: undefined, beerProfile: undefined, servings: undefined };
    });
  }

  function saveSettings(next: MenuSettings, message: string) {
    try {
      window.localStorage.setItem(MENU_SETTINGS_STORAGE_KEY, JSON.stringify(next));
      setSettings(next);
      setNotice(message);
    } catch {
      setNotice("No se pudieron guardar las categorías.");
    }
  }

  function addOption(key: SettingsKey) {
    const value = newOptions[key]?.trim();
    if (!value || settings[key].some((item) => item.toLocaleLowerCase("es") === value.toLocaleLowerCase("es"))) return;
    const next = { ...settings, [key]: [...settings[key], value] };
    saveSettings(next, `Se agregó “${value}”. Ya puede asignarse a productos.`);
    setNewOptions((current) => ({ ...current, [key]: "" }));
  }

  function removeOption(key: SettingsKey, value: string) {
    const next = { ...settings, [key]: settings[key].filter((item) => item !== value) };
    saveSettings(next, `Se quitó “${value}” de las opciones disponibles.`);
  }

  function readCredentials(): AdminCredentials | null {
    const stored = window.localStorage.getItem(ADMIN_CREDENTIALS_KEY);
    if (!stored) return null;
    try { return JSON.parse(stored) as AdminCredentials; }
    catch { return null; }
  }

  function persistBanners(next: Banner[]) {
    try {
      window.localStorage.setItem(BANNERS_STORAGE_KEY, JSON.stringify(next));
      setBanners(next);
    } catch {
      setNotice("No se pudieron guardar las novedades.");
    }
  }

  function addBanner() {
    const banner: Banner = {
      id: `banner-${Date.now()}`,
      title: "Nueva novedad",
      subtitle: "",
      imageUrl: "",
      ctaLabel: "Ver más",
      ctaHref: "#",
      visible: true,
    };
    const next = [...banners, banner];
    persistBanners(next);
    setBannerDraft(banner);
    setNotice("Novedad creada. Editá los campos y guardá.");
  }

  function updateBannerDraft<K extends keyof Banner>(key: K, value: Banner[K]) {
    setBannerDraft((current) => current ? { ...current, [key]: value } : null);
  }

  function deleteBanner(id: string) {
    if (!window.confirm("¿Eliminar esta novedad?")) return;
    const next = banners.filter((b) => b.id !== id);
    persistBanners(next);
    if (bannerDraft?.id === id) setBannerDraft(null);
    setNotice("Novedad eliminada.");
  }

  function toggleBannerVisible(id: string) {
    const next = banners.map((b) => b.id === id ? { ...b, visible: !b.visible } : b);
    persistBanners(next);
  }

  function persistPromos(next: Promo[]) {
    try {
      window.localStorage.setItem(PROMOS_STORAGE_KEY, JSON.stringify(next));
      setPromos(next);
    } catch { setNotice("No se pudieron guardar las promociones."); }
  }

  function addPromo() {
    const promo: Promo = { id: `promo-${Date.now()}`, productId: products[0]?.id ?? "", type: "2x1", days: [], active: true };
    persistPromos([...promos, promo]);
    setPromoDraft(promo);
  }

  function deletePromo(id: string) {
    if (!window.confirm("¿Eliminar esta promoción?")) return;
    persistPromos(promos.filter((p) => p.id !== id));
    if (promoDraft?.id === id) setPromoDraft(null);
    setNotice("Promoción eliminada.");
  }

  function togglePromoActive(id: string) {
    persistPromos(promos.map((p) => p.id === id ? { ...p, active: !p.active } : p));
  }

  function updatePromoDraft<K extends keyof Promo>(key: K, value: Promo[K]) {
    setPromoDraft((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  function refreshAnalytics() {
    setAnalyticsEvents(getStoredEvents());
    setNotice("Datos de analíticas actualizados.");
  }

  function handleClearAnalytics() {
    if (!window.confirm("¿Borrar todos los eventos registrados? Esta acción no se puede deshacer.")) return;
    clearStoredEvents();
    setAnalyticsEvents([]);
    setNotice("Historial de analíticas borrado.");
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    const credentials = readCredentials();
    const expectedUsername = credentials?.username ?? DEFAULT_ADMIN_USERNAME;
    const expectedHash = credentials?.passwordHash ?? await hashPassword(DEFAULT_ADMIN_PASSWORD);
    const suppliedHash = await hashPassword(loginPassword);
    if (loginUsername.trim() !== expectedUsername || suppliedHash !== expectedHash) {
      setLoginError("El usuario o la contraseña no son correctos.");
      return;
    }
    window.sessionStorage.setItem(ADMIN_SESSION_KEY, "active");
    setAuthenticated(true);
    setSecurityUsername(expectedUsername);
    setLoginPassword("");
    setNotice("Sesión iniciada correctamente.");
  }

  function logout() {
    window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
    setAuthenticated(false);
    setLoginPassword("");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  function updateAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setAppSettings((current) => ({ ...current, [key]: value }));
  }

  function handleBrandImage(event: ChangeEvent<HTMLInputElement>, key: "logoUrl" | "heroImageUrl") {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      setNotice("Para esta demostración, la imagen debe pesar menos de 1,5 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        updateAppSetting(key, reader.result);
        setNotice("Imagen de marca cargada. Falta guardar los ajustes.");
      }
    };
    reader.readAsDataURL(file);
  }

  function saveAppSettings() {
    try {
      window.localStorage.setItem(ADMIN_APP_SETTINGS_KEY, JSON.stringify(appSettings));
      setNotice("Los ajustes generales quedaron guardados.");
    } catch {
      setNotice("No se pudieron guardar los ajustes generales.");
    }
  }

  function updatePortalSetting<K extends keyof PortalSettings>(key: K, value: PortalSettings[K]) {
    setPortalSettings((current) => ({ ...current, [key]: value }));
  }

  function updatePortalAction(id: string, patch: Partial<PortalAction>) {
    setPortalSettings((current) => ({ ...current, actions: current.actions.map((action) => action.id === id ? { ...action, ...patch } : action) }));
  }

  function movePortalAction(id: string, direction: -1 | 1) {
    setPortalSettings((current) => {
      const index = current.actions.findIndex((action) => action.id === id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.actions.length) return current;
      const actions = [...current.actions];
      [actions[index], actions[destination]] = [actions[destination], actions[index]];
      return { ...current, actions };
    });
    setNotice("Orden actualizado. Guardá el portal para publicar el cambio.");
  }

  function addPortalAction() {
    const action: PortalAction = {
      id: `link-${Date.now()}`,
      label: "Nuevo acceso",
      description: "Descripción breve",
      href: "#",
      icon: "link",
      style: "compact",
      visible: true,
    };
    setPortalSettings((current) => ({ ...current, actions: [...current.actions, action] }));
    setNotice("Nuevo acceso agregado al final de la lista.");
  }

  function removePortalAction(action: PortalAction) {
    if (!window.confirm(`¿Eliminar el acceso “${action.label}”?`)) return;
    setPortalSettings((current) => ({ ...current, actions: current.actions.filter((item) => item.id !== action.id) }));
    setNotice("Acceso eliminado. Falta guardar el portal.");
  }

  function handlePortalCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      setNotice("Para esta demostración, la portada debe pesar menos de 1,5 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        updatePortalSetting("coverImageUrl", reader.result);
        setNotice("Portada cargada. Falta guardar el portal.");
      }
    };
    reader.readAsDataURL(file);
  }

  function savePortalSettings() {
    try {
      window.localStorage.setItem(PORTAL_SETTINGS_STORAGE_KEY, JSON.stringify(portalSettings));
      setNotice("Portal guardado. Los cambios ya están disponibles en la portada pública.");
    } catch {
      setNotice("No se pudo guardar el portal. Probá con una imagen de portada más liviana.");
    }
  }

  async function saveSecuritySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const credentials = readCredentials();
    const expectedHash = credentials?.passwordHash ?? await hashPassword(DEFAULT_ADMIN_PASSWORD);
    if (await hashPassword(currentPassword) !== expectedHash) {
      setNotice("La contraseña actual no coincide.");
      return;
    }
    if (!securityUsername.trim()) {
      setNotice("El nombre de usuario no puede quedar vacío.");
      return;
    }
    if (newPassword && newPassword.length < 6) {
      setNotice("La contraseña nueva debe tener al menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setNotice("La confirmación de la contraseña no coincide.");
      return;
    }
    const next: AdminCredentials = {
      username: securityUsername.trim(),
      passwordHash: newPassword ? await hashPassword(newPassword) : expectedHash,
    };
    window.localStorage.setItem(ADMIN_CREDENTIALS_KEY, JSON.stringify(next));
    setHasCustomCredentials(true);
    setSecurityUsername(next.username);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setNotice("Usuario y contraseña actualizados correctamente.");
  }

  if (!hydrated) return <main className="admin-loading">Preparando el panel del restaurante…</main>;

  if (!authenticated) return <main className="admin-login-shell">
    <section className="admin-login-card">
      <div className="admin-login-brand"><img src={appSettings.logoUrl} alt={appSettings.businessName}/><span><small>ACCESO PRIVADO</small><strong>Panel administrativo</strong></span></div>
      <div className="admin-login-copy"><p>GESTIÓN · PLANTILLA RESTAURANTE</p><h1>Bienvenido de nuevo.</h1><span>Ingresá con tu usuario y contraseña para administrar el menú.</span></div>
      <form onSubmit={handleLogin}>
        <label>Usuario<input autoComplete="username" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} placeholder="Tu usuario" autoFocus/></label>
        <label>Contraseña<div className="admin-password-field"><input type={showLoginPassword ? "text" : "password"} autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder="Tu contraseña"/><button type="button" onClick={() => setShowLoginPassword((current) => !current)}>{showLoginPassword ? "Ocultar" : "Ver"}</button></div></label>
        {loginError && <p className="admin-login-error">{loginError}</p>}
        <button className="admin-login-submit" type="submit">Ingresar al panel</button>
      </form>
      {!hasCustomCredentials && <div className="admin-login-help"><span>Acceso inicial de demostración</span><strong>Usuario: admin · Contraseña: menu2026</strong></div>}
      <a href="/">← Volver al menú público</a>
    </section>
  </main>;

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand"><img src={appSettings.logoUrl} alt={appSettings.businessName}/><span><small>GESTIÓN DEL MENÚ</small><strong>Panel administrativo</strong></span></div>
        <div className="admin-top-actions"><span className="admin-local-badge">● Guardado local</span><span className="admin-user-badge"><i>{securityUsername.slice(0, 1).toLocaleUpperCase("es")}</i><b>{securityUsername}</b></span><button className="admin-logout" onClick={logout}>Salir</button><a href="/portal">Ver portal <b>→</b></a><a href="/">Ver menú <b>→</b></a></div>
      </header>

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-nav-label">ADMINISTRACIÓN</div>
          <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}><span>01</span><div><strong>Productos</strong><small>Fotos, textos y precios</small></div></button>
          <button className={tab === "portal" ? "active" : ""} onClick={() => setTab("portal")}><span>02</span><div><strong>Portal</strong><small>Portada y accesos</small></div></button>
          <button className={tab === "adjustments" ? "active" : ""} onClick={() => setTab("adjustments")}><span>03</span><div><strong>Ajustes</strong><small>Negocio y seguridad</small></div></button>
          <button className={tab === "banners" ? "active" : ""} onClick={() => setTab("banners")}><span>04</span><div><strong>Novedades</strong><small>Banners y eventos</small></div></button>
          <button className={tab === "evento" ? "active" : ""} onClick={() => setTab("evento")}><span>05</span><div><strong>Menú Evento</strong><small>Carta reducida para eventos</small></div></button>
          <button className={tab === "analytics" ? "active" : ""} onClick={() => { setTab("analytics"); setAnalyticsEvents(getStoredEvents()); }}><span>06</span><div><strong>Analíticas</strong><small>Métricas del menú</small></div></button>
          <div className="admin-sidebar-note"><strong>Sesión protegida</strong><p>Este acceso funciona en el dispositivo de demostración. En producción se validará desde el servidor y la base de datos.</p></div>
        </aside>

        <section className="admin-content">
          <div className="admin-heading">
            <div><p>{appSettings.businessName.toLocaleUpperCase("es")} · EXPERIENCIA DIGITAL</p><h1>{tab === "products" ? "Productos del menú" : tab === "filters" ? "Filtros y clasificaciones" : tab === "portal" ? "Portal del restaurante" : tab === "banners" ? "Novedades y banners" : tab === "analytics" ? "Analíticas del menú" : tab === "evento" ? "Menú Evento" : "Ajustes del sistema"}</h1><span>{tab === "products" ? "Editá lo que el cliente ve al abrir cada producto." : tab === "filters" ? "Definí las opciones que aparecen en los filtros y formularios." : tab === "portal" ? "Configurá la portada, los accesos y su orden sin modificar el menú." : tab === "banners" ? "Creá y publicá banners visibles en la carta. El cliente los ve al abrir el menú." : tab === "analytics" ? "Seguimiento de interacciones, conversiones y comportamiento de los clientes." : tab === "evento" ? "Activá la carta reducida para eventos especiales. Solo se muestran los productos marcados." : "Administrá la identidad, los datos del negocio y las credenciales."}</span></div>
            {tab === "products" ? <button className="admin-primary-action" onClick={() => startNew()}>＋ Nuevo producto</button> : tab === "portal" ? <button className="admin-primary-action" onClick={addPortalAction}>＋ Nuevo acceso</button> : tab === "banners" ? <><button className="admin-primary-action" onClick={addPromo}>＋ Nueva promoción</button><button className="admin-secondary-action" onClick={addBanner}>＋ Nueva novedad</button></> : tab === "analytics" ? <button className="admin-primary-action" onClick={refreshAnalytics}>↺ Actualizar</button> : null}
          </div>

          {(tab === "products" || tab === "evento") && <div className="admin-stats">
            <article><small>TOTAL PUBLICADOS</small><strong>{products.length}</strong><span>productos</span></article>
            <article><small>COMIDAS</small><strong>{foodCount}</strong><span>platos</span></article>
            <article><small>BEBIDAS</small><strong>{drinkCount}</strong><span>opciones</span></article>
            <article className="admin-notice"><small>ESTADO</small><p>{notice}</p></article>
          </div>}

          {tab === "products" ? <div className="admin-product-workspace">
            <section className="admin-product-list">
              <div className="admin-list-tools">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto"/>
                <div>{(["Todos", "Cocina", "Cervezas"] as const).map((filter) => <button key={filter} className={categoryFilter === filter ? "active" : ""} onClick={() => setCategoryFilter(filter)}>{filter === "Cocina" ? "Comida" : filter === "Cervezas" ? "Bebida" : filter}</button>)}</div>
              </div>
              <div className="admin-products-scroll">
                {filteredProducts.map((product) => <button className={selectedId === product.id && !isNew ? "admin-product-row active" : "admin-product-row"} key={product.id} onClick={() => selectProduct(product)}>
                  {product.image ? <img src={product.image} alt=""/> : <span className="admin-image-placeholder">CN</span>}
                  <span><strong>{product.name}</strong><small>{product.group}</small></span>
                  <b>{formatPrice(product.price)}</b>
                </button>)}
                {!filteredProducts.length && <p className="admin-empty">No hay productos para esta búsqueda.</p>}
              </div>
            </section>

            <section className="admin-editor">
              <div className="admin-editor-title"><div><p>{isNew ? "NUEVO PRODUCTO" : "EDITAR PRODUCTO"}</p><h2>{draft.name || "Sin nombre todavía"}</h2></div><span>{draft.category === "Cocina" ? "Comida" : "Bebida"}</span></div>

              <div className="admin-photo-editor">
                <div>{draft.image ? <img src={draft.image} alt="Vista previa del producto"/> : <span>Sin foto</span>}</div>
                <section><label>Imagen del producto<input value={draft.image ?? ""} onChange={(event) => updateDraft("image", event.target.value)} placeholder="/images/producto.jpg o dirección web"/></label><label className="admin-upload">Elegir foto del dispositivo<input type="file" accept="image/*" onChange={handlePhoto}/></label><small>En esta demo: JPG, PNG o WebP de hasta 1,5 MB.</small></section>
              </div>

              <div className="admin-form-section">
                <div className="admin-section-title"><span>01</span><div><h3>Información principal</h3><p>Nombre, descripción y precio que verá el cliente.</p></div></div>
                <div className="admin-form-grid">
                  <label className="wide">Nombre del producto<input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="Ej. Hamburguesa de la casa"/></label>
                  <label>Categoría<select value={draft.category} onChange={(event) => changeProductCategory(event.target.value as Product["category"])}><option value="Cocina">Comida</option><option value="Cervezas">Bebida</option></select></label>
                  <label>Tipo<select value={draft.group} onChange={(event) => changeProductGroup(event.target.value)}>{selectableGroups.map((group) => <option key={group}>{group}</option>)}</select></label>
                  <label>Precio base<input type="number" min="0" step="100" value={draft.price} onChange={(event) => updateDraft("price", Number(event.target.value))}/></label>
                  <label>Etiqueta corta<input value={draft.tag} onChange={(event) => updateDraft("tag", event.target.value)} placeholder="Ej. Recomendado"/></label>
                  <label className="wide">Descripción<textarea rows={3} value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} placeholder="Ingredientes, preparación y presentación…"/></label>
                  <label className="wide">Nota interna / provisional<textarea rows={2} value={draft.note} onChange={(event) => updateDraft("note", event.target.value)}/></label>
                </div>
              </div>

              <div className="admin-form-section">
                <div className="admin-section-title"><span>02</span><div><h3>Preferencias y alérgenos</h3><p>Ayudan a filtrar y tomar una decisión segura.</p></div></div>
                <div className="admin-check-groups">
                  <fieldset><legend>Preferencias</legend><div>{settings.foodPreferences.map((item) => <label key={item}><input type="checkbox" checked={draft.attributes.includes(item)} onChange={() => toggleDraftList("attributes", item)}/><span>{item}</span></label>)}</div></fieldset>
                  <fieldset><legend>Alérgenos declarados</legend><div>{settings.allergenOptions.map((item) => <label key={item}><input type="checkbox" checked={draft.allergens.includes(item)} onChange={() => toggleDraftList("allergens", item)}/><span>{item}</span></label>)}</div></fieldset>
                </div>
              </div>

              {isCraftBeer && <div className="admin-form-section">
                <div className="admin-section-title"><span>03</span><div><h3>Características de la cerveza</h3><p>Estilo, perfil técnico y precios por formato.</p></div></div>
                <div className="admin-form-grid">
                  <label>Color / familia<select value={draft.beerStyle ?? ""} onChange={(event) => updateDraft("beerStyle", event.target.value)}><option value="">Elegir…</option>{settings.beerStyles.map((style) => <option key={style}>{style}</option>)}</select></label>
                  <label>Nombre del estilo<input value={ensureBeerProfile().style} onChange={(event) => updateBeerProfile("style", event.target.value)}/></label>
                  <label>IBU<input value={ensureBeerProfile().ibu} onChange={(event) => updateBeerProfile("ibu", event.target.value)}/></label>
                  <label>ABV<input value={ensureBeerProfile().abv} onChange={(event) => updateBeerProfile("abv", event.target.value)} placeholder="Ej. 5%"/></label>
                  <label>SRM<input value={ensureBeerProfile().srm} onChange={(event) => updateBeerProfile("srm", event.target.value)}/></label>
                  <label className="wide">Descriptores separados por coma<input value={ensureBeerProfile().descriptors.join(", ")} onChange={(event) => updateBeerProfile("descriptors", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="Ligera, refrescante, equilibrada"/></label>
                </div>
                <div className="admin-serving-editor">{(draft.servings ?? [{ label: "Media pinta", volume: "250 cc", price: 0 }, { label: "Pinta", volume: "500 cc", price: 0 }, { label: "Jarra", volume: "1 L", price: 0 }]).map((serving) => <article key={serving.label}><strong>{serving.label}</strong><label>Capacidad<input value={serving.volume} onChange={(event) => updateServing(serving.label, "volume", event.target.value)}/></label><label>Precio<input type="number" min="0" value={serving.price} onChange={(event) => updateServing(serving.label, "price", event.target.value)}/></label></article>)}</div>
              </div>}

              <div className="admin-form-section">
                <div className="admin-section-title"><span>{isCraftBeer ? "04" : "03"}</span><div><h3>Información nutricional</h3><p>Valores que aparecen al abrir el producto.</p></div></div>
                <div className="admin-form-grid nutrition-admin-grid">
                  <label>Base de cálculo<input value={draft.nutrition.basis} onChange={(event) => updateNutrition("basis", event.target.value)}/></label>
                  <label>Calorías<input value={draft.nutrition.calories} onChange={(event) => updateNutrition("calories", event.target.value)}/></label>
                  <label>Grasas<input value={draft.nutrition.fats} onChange={(event) => updateNutrition("fats", event.target.value)}/></label>
                  <label>Proteínas<input value={draft.nutrition.proteins} onChange={(event) => updateNutrition("proteins", event.target.value)}/></label>
                  <label>Carbohidratos<input value={draft.nutrition.carbs} onChange={(event) => updateNutrition("carbs", event.target.value)}/></label>
                  <label>Azúcares<input value={draft.nutrition.sugars} onChange={(event) => updateNutrition("sugars", event.target.value)}/></label>
                </div>
              </div>

              <div className="admin-form-section">
                <div className="admin-section-title"><span>{isCraftBeer ? "05" : "04"}</span><div><h3>Venta relacionada</h3><p>Elegí qué productos mostrar en “Se puede acompañar con”.</p></div></div>
                <div className="admin-related-grid">{products.filter((product) => product.id !== selectedId).map((product) => <label key={product.id}><input type="checkbox" checked={draft.relatedIds.includes(product.id)} onChange={() => toggleDraftList("relatedIds", product.id)}/>{product.image ? <img src={product.image} alt=""/> : <span>CN</span>}<strong>{product.name}</strong></label>)}</div>
              </div>

              {draft.category === "Cocina" && <div className="admin-form-section">
                <div className="admin-section-title"><span>{isCraftBeer ? "06" : "05"}</span><div><h3>Ingredientes editables</h3><p>El cliente puede pedir que se saquen estos ingredientes al momento de pedir.</p></div></div>
                <div className="admin-ingredients-editor">
                  <div className="admin-option-list">{(draft.removableIngredients ?? []).map((item) => <span key={item}>{item}<button type="button" onClick={() => updateDraft("removableIngredients", (draft.removableIngredients ?? []).filter((i) => i !== item))} aria-label={`Eliminar ${item}`}>×</button></span>)}</div>
                  <form className="admin-add-ingredient" onSubmit={(e) => { e.preventDefault(); const input = (e.currentTarget.elements.namedItem("ingredient") as HTMLInputElement); const val = input.value.trim(); if (!val || (draft.removableIngredients ?? []).includes(val)) return; updateDraft("removableIngredients", [...(draft.removableIngredients ?? []), val]); input.value = ""; }}><input name="ingredient" placeholder="Ej. Mayonesa, Aceitunas, Cebolla…"/><button type="submit">Agregar</button></form>
                </div>
              </div>}

              <div className="admin-form-section">
                <div className="admin-section-title"><span>{isCraftBeer ? "07" : "06"}</span><div><h3>Disponibilidad</h3><p>Controlá si el producto está disponible para pedir.</p></div></div>
                <div className="admin-promo-stock">
                  <label className="admin-stock-toggle"><input type="checkbox" checked={!!draft.outOfStock} onChange={(e) => updateDraft("outOfStock", e.target.checked)}/><span><strong>Sin stock</strong><small>El producto se muestra como no disponible</small></span><i/></label>
                </div>
              </div>

              {isNew && <div className="admin-editor-actions"><button className="admin-save" onClick={saveProduct}>Crear producto</button></div>}
              {!isNew && <div className="admin-editor-actions"><button className="admin-delete" onClick={deleteProduct}>Eliminar producto</button></div>}
            </section>
          </div> : tab === "banners" ? <div className="admin-banners-layout">

            <div className="admin-section-block">
              <div className="admin-section-block-header"><h3>Promociones programadas</h3><p>Se activan y desactivan solas según el horario. El precio original se restaura automáticamente.</p></div>
              {promos.length === 0 && <div className="admin-empty-notice"><p>Sin promociones todavía. Usá "＋ Nueva promoción" para crear la primera.</p></div>}
              <div className="admin-banners-list">
                {promos.map((promo) => {
                  const prod = products.find(p => p.id === promo.productId);
                  const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
                  const scheduleLabel = promo.days.length === 0 ? "Todos los días" : promo.days.map(d => DAY_LABELS[d]).join(", ");
                  const timeLabel = promo.timeStart && promo.timeEnd ? ` · ${promo.timeStart}–${promo.timeEnd}` : "";
                  const typeLabel = promo.type === "2x1" ? "2×1" : promo.type === "precio" ? `Precio especial $${promo.promoPrice ?? "—"}` : `${promo.promoPercent ?? "—"}% off`;
                  const currentlyOn = isPromoActive(promo);
                  return <article key={promo.id} className={`admin-banner-card${promoDraft?.id === promo.id ? " is-editing" : ""}${!promo.active ? " is-hidden" : ""}`}>
                    <header className="admin-banner-header">
                      <div>
                        <strong>{prod?.name ?? "Producto eliminado"} · {typeLabel}</strong>
                        <small>{promo.active ? (currentlyOn ? "● Activa ahora" : "○ Programada") : "○ Desactivada"} · {scheduleLabel}{timeLabel}</small>
                      </div>
                      <div className="admin-banner-actions">
                        <button onClick={() => togglePromoActive(promo.id)}>{promo.active ? "Desactivar" : "Activar"}</button>
                        <button onClick={() => setPromoDraft(promoDraft?.id === promo.id ? null : structuredClone(promo))}>Editar</button>
                        <button className="admin-delete-inline" onClick={() => deletePromo(promo.id)}>×</button>
                      </div>
                    </header>
                    {promoDraft?.id === promo.id && <div className="admin-form-grid admin-banner-form">
                      <label className="wide">Producto<select value={promoDraft.productId} onChange={(e) => updatePromoDraft("productId", e.target.value)}>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                      <label className="wide">Tipo de promoción
                        <select value={promoDraft.type} onChange={(e) => updatePromoDraft("type", e.target.value as Promo["type"])}>
                          <option value="2x1">2×1</option>
                          <option value="precio">Precio especial</option>
                          <option value="porcentaje">% Off</option>
                        </select>
                      </label>
                      {promoDraft.type === "precio" && <label>Precio promocional<input type="number" min="0" step="100" value={promoDraft.promoPrice ?? ""} onChange={(e) => updatePromoDraft("promoPrice", Number(e.target.value))} placeholder="0"/></label>}
                      {promoDraft.type === "porcentaje" && <label>% de descuento<input type="number" min="1" max="99" value={promoDraft.promoPercent ?? ""} onChange={(e) => updatePromoDraft("promoPercent", Number(e.target.value))} placeholder="20"/></label>}
                      <label className="wide">Días activos
                        <div className="admin-days-selector">{(["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"] as const).map((label, i) => <button type="button" key={i} className={promoDraft.days.includes(i) ? "active" : ""} onClick={() => updatePromoDraft("days", promoDraft.days.includes(i) ? promoDraft.days.filter(d => d !== i) : [...promoDraft.days, i].sort())}>{label}</button>)}</div>
                        <small>Sin selección = todos los días</small>
                      </label>
                      <label>Hora de inicio<input type="time" value={promoDraft.timeStart ?? ""} onChange={(e) => updatePromoDraft("timeStart", e.target.value || undefined)}/></label>
                      <label>Hora de fin<input type="time" value={promoDraft.timeEnd ?? ""} onChange={(e) => updatePromoDraft("timeEnd", e.target.value || undefined)}/></label>
                    </div>}
                  </article>;
                })}
              </div>
            </div>

            <div className="admin-section-block">
              <div className="admin-section-block-header"><h3>Banners de novedades</h3><p>Se muestran en la parte superior del menú del cliente.</p></div>
              {banners.length === 0 && <div className="admin-empty-notice"><p>No hay novedades creadas todavía.</p></div>}
              <div className="admin-banners-list">
                {banners.map((banner) => <article key={banner.id} className={`admin-banner-card${bannerDraft?.id === banner.id ? " is-editing" : ""}${!banner.visible ? " is-hidden" : ""}`}>
                  <header className="admin-banner-header">
                    <div><strong>{banner.title || "Sin título"}</strong><small>{banner.visible ? "● Visible en el menú" : "○ Oculta"}</small></div>
                    <div className="admin-banner-actions">
                      <button onClick={() => toggleBannerVisible(banner.id)}>{banner.visible ? "Ocultar" : "Publicar"}</button>
                      <button onClick={() => setBannerDraft(bannerDraft?.id === banner.id ? null : structuredClone(banner))}>Editar</button>
                      <button className="admin-delete-inline" onClick={() => deleteBanner(banner.id)}>×</button>
                    </div>
                  </header>
                  {bannerDraft?.id === banner.id && <div className="admin-form-grid admin-banner-form">
                    <label className="wide">Título<input value={bannerDraft.title} onChange={(e) => updateBannerDraft("title", e.target.value)} placeholder="Ej. Evento especial esta semana"/></label>
                    <label className="wide">Subtítulo<input value={bannerDraft.subtitle} onChange={(e) => updateBannerDraft("subtitle", e.target.value)} placeholder="Descripción breve (opcional)"/></label>
                    <label className="wide">URL de imagen<input value={bannerDraft.imageUrl} onChange={(e) => updateBannerDraft("imageUrl", e.target.value)} placeholder="/images/... o https://..."/></label>
                    <label>Texto del botón<input value={bannerDraft.ctaLabel} onChange={(e) => updateBannerDraft("ctaLabel", e.target.value)}/></label>
                    <label>Destino del botón<input value={bannerDraft.ctaHref} onChange={(e) => updateBannerDraft("ctaHref", e.target.value)} placeholder="#carta, /portal o https://..."/></label>
                  </div>}
                </article>)}
              </div>
            </div>

          </div> : tab === "analytics" ? <div className="admin-analytics">
            <div className="analytics-filter-bar">
              <div className="analytics-date-buttons">
                {(["today", "7d", "30d", "all"] as const).map((range) => <button key={range} className={dateRange === range ? "active" : ""} onClick={() => setDateRange(range)}>{range === "today" ? "Hoy" : range === "7d" ? "7 días" : range === "30d" ? "30 días" : "Todo"}</button>)}
              </div>
              <span className="analytics-event-count">{analyticsData.filtered.length} eventos registrados</span>
            </div>

            <div className="admin-stats">
              <article><small>SESIONES</small><strong>{analyticsData.sessions}</strong><span>visitas únicas</span></article>
              <article><small>VISTAS DE PRODUCTO</small><strong>{analyticsData.viewCount}</strong><span>aperturas</span></article>
              <article><small>AL CARRITO</small><strong>{analyticsData.cartAddCount}</strong><span>agregados</span></article>
              <article><small>PEDIDOS ENVIADOS</small><strong>{analyticsData.cartSendCount}</strong><span>órdenes</span></article>
            </div>

            <div className="analytics-conversion-row">
              <article><small>VISTA → CARRITO</small><strong>{analyticsData.viewConversion}%</strong><span>conversión</span></article>
              <article><small>SESIÓN → PEDIDO</small><strong>{analyticsData.sessionConversion}%</strong><span>conversión</span></article>
              <article><small>CROSS-SELL CLICKS</small><strong>{analyticsData.crosssellCount}</strong><span>interacciones</span></article>
              <article><small>EVENTOS ABIERTOS</small><strong>{analyticsData.eventsOpensCount}</strong><span>aperturas</span></article>
              <article><small>MOZO DIGITAL</small><strong>{analyticsData.assistantOpensCount}</strong><span>consultas</span></article>
            </div>

            <article className="admin-adjustment-card">
              <div className="admin-adjustment-heading"><span>01</span><div><small>ACTIVIDAD</small><h2>Sesiones por día</h2><p>Últimas dos semanas.</p></div></div>
              <div className="analytics-bar-chart">
                {analyticsData.days.map((day) => <div key={day.date} className="analytics-bar-col">
                  <span className="analytics-bar-value">{day.count > 0 ? day.count : ""}</span>
                  <div className="analytics-bar" style={{ height: `${Math.round((day.count / analyticsData.maxDayCount) * 100)}%` }} />
                  <span className="analytics-bar-label">{day.label}</span>
                </div>)}
              </div>
            </article>

            <article className="admin-adjustment-card">
              <div className="admin-adjustment-heading"><span>02</span><div><small>PRODUCTOS</small><h2>Más vistos</h2><p>Aperturas de detalle, agregados al carrito y conversión.</p></div></div>
              {analyticsData.topProducts.length === 0 ? <p className="analytics-empty">Sin datos para este período.</p> : <div className="analytics-product-table">
                <div className="analytics-table-header"><span>Producto</span><span>Vistas</span><span>Carrito</span><span>Conv.</span></div>
                {analyticsData.topProducts.map(({ id, views, cartAdds: adds }) => <div key={id} className="analytics-table-row">
                  <span className="analytics-product-name">{products.find((p) => p.id === id)?.name ?? id}</span>
                  <span><strong>{views}</strong></span>
                  <span>{adds}</span>
                  <span className="analytics-conv-badge">{views > 0 ? `${Math.round((adds / views) * 100)}%` : "—"}</span>
                </div>)}
              </div>}
            </article>

            <article className="admin-adjustment-card">
              <div className="admin-adjustment-heading"><span>03</span><div><small>CROSS-SELL</small><h2>Pares más clickeados</h2><p>Desde qué producto se abre con más frecuencia cada sugerencia.</p></div></div>
              {analyticsData.topPairs.length === 0 ? <p className="analytics-empty">Sin datos para este período.</p> : <div className="analytics-pairs-list">
                {analyticsData.topPairs.map(({ pair, count }) => {
                  const [fromId, toId] = pair.split("→");
                  return <div key={pair} className="analytics-pair-row">
                    <span>{products.find((p) => p.id === fromId)?.name ?? fromId}</span>
                    <i>→</i>
                    <span>{products.find((p) => p.id === toId)?.name ?? toId}</span>
                    <strong>{count} clicks</strong>
                  </div>;
                })}
              </div>}
            </article>

            <div className="analytics-two-col">
              <article className="admin-adjustment-card">
                <div className="admin-adjustment-heading"><span>04</span><div><small>IDIOMAS</small><h2>Cambios de idioma</h2></div></div>
                {Object.keys(analyticsData.langCounts).length === 0 ? <p className="analytics-empty">Sin datos.</p> : <div className="analytics-list">
                  {Object.entries(analyticsData.langCounts).sort((a, b) => b[1] - a[1]).map(([lang, count]) => <div key={lang} className="analytics-list-row"><span>{lang.toUpperCase()}</span><strong>{count}</strong></div>)}
                </div>}
              </article>
              <article className="admin-adjustment-card">
                <div className="admin-adjustment-heading"><span>05</span><div><small>FILTROS</small><h2>Más utilizados</h2></div></div>
                {analyticsData.topFilters.length === 0 ? <p className="analytics-empty">Sin datos.</p> : <div className="analytics-list">
                  {analyticsData.topFilters.map(([name, count]) => <div key={name} className="analytics-list-row"><span>{name}</span><strong>{count}</strong></div>)}
                </div>}
              </article>
            </div>

            {Object.keys(analyticsData.bannerCounts).length > 0 && <article className="admin-adjustment-card">
              <div className="admin-adjustment-heading"><span>06</span><div><small>NOVEDADES</small><h2>Rendimiento de banners</h2></div></div>
              <div className="analytics-product-table">
                <div className="analytics-table-header"><span>Banner</span><span>Impresiones</span><span>Clicks</span><span>CTR</span></div>
                {Object.entries(analyticsData.bannerCounts)
                  .sort((a, b) => b[1].views - a[1].views)
                  .map(([id, { clicks, views }]) => {
                    const ctr = views > 0 ? Math.round((clicks / views) * 100) : 0;
                    return (
                      <div key={id} className="analytics-table-row">
                        <span className="analytics-product-name">{banners.find((b) => b.id === id)?.title ?? id}</span>
                        <span>{views}</span>
                        <span>{clicks}</span>
                        <span className="analytics-conv-badge">{ctr}%</span>
                      </div>
                    );
                  })}
              </div>
            </article>}

            <div className="analytics-danger-zone">
              <p>Los eventos se guardan en este navegador. Al limpiar el historial se pierden permanentemente.</p>
              <button className="admin-delete" onClick={handleClearAnalytics}>Limpiar historial de analíticas</button>
            </div>
          </div> : tab === "evento" ? <div className="admin-adjustments-grid">
            <article className="admin-adjustment-card">
              <div className="admin-adjustment-heading"><span>01</span><div><small>MODO EVENTO</small><h2>Activar carta de evento</h2><p>Cuando está activo, el menú público muestra únicamente los productos marcados como «Evento». Los filtros y las categorías se adaptan automáticamente.</p></div></div>
              <div className="admin-toggle-list">
                <label><span><strong>Menú evento activo</strong><small>{appSettings.eventModeActive ? "Los clientes ven la carta reducida de evento." : "Los clientes ven el menú completo."}</small></span><input type="checkbox" checked={appSettings.eventModeActive} onChange={(e) => updateAppSetting("eventModeActive", e.target.checked)}/><i/></label>
              </div>
              <div className="admin-adjustment-actions"><button onClick={saveAppSettings}>Guardar y aplicar</button></div>
            </article>

            <article className="admin-adjustment-card">
              <div className="admin-adjustment-heading"><span>02</span><div><small>PRODUCTOS DEL EVENTO</small><h2>Seleccioná qué aparece</h2><p>Marcá los productos que van a estar disponibles cuando el modo evento esté activo. El resto queda oculto automáticamente.</p></div></div>
              <div className="admin-event-product-list">
                {["Cocina", "Cervezas"].map((cat) => {
                  const catProducts = products.filter((p) => p.category === cat);
                  if (!catProducts.length) return null;
                  return <div key={cat} className="admin-event-category">
                    <p className="admin-event-cat-label">{cat === "Cocina" ? "Comida" : "Bebida"}</p>
                    {catProducts.map((p) => <label key={p.id} className="admin-event-product-row">
                      <input type="checkbox" checked={!!p.eventoMenu} onChange={() => {
                        const next = products.map((prod) => prod.id === p.id ? { ...prod, eventoMenu: !prod.eventoMenu } : prod);
                        persistProducts(next);
                        setNotice(`"${p.name}" ${!p.eventoMenu ? "agregado al" : "quitado del"} menú evento.`);
                      }}/>
                      {p.image ? <img src={p.image} alt=""/> : <span className="admin-image-placeholder">CN</span>}
                      <span><strong>{p.name}</strong><small>{p.group}</small></span>
                      {p.eventoMenu && <span className="admin-event-badge">Evento</span>}
                    </label>)}
                  </div>;
                })}
              </div>
              <div className="admin-adjustment-actions">
                <span>{products.filter((p) => p.eventoMenu).length} productos marcados para evento</span>
              </div>
            </article>
          </div> : tab === "portal" ? <div className="admin-portal-layout">
            <div className="admin-portal-editor">
              <article className="admin-portal-section">
                <div className="admin-section-title"><span>01</span><div><h3>Presentación del portal</h3><p>La identidad utiliza el logo, nombre y color definidos en Ajustes.</p></div></div>
                <div className="admin-photo-editor admin-portal-cover">
                  <div><img src={portalSettings.coverImageUrl || appSettings.heroImageUrl} alt="Vista previa de la portada"/></div>
                  <section><label>Dirección de imagen<input value={portalSettings.coverImageUrl} onChange={(event) => updatePortalSetting("coverImageUrl", event.target.value)} placeholder="/images/portada.jpg o dirección web"/></label><label className="admin-upload">Elegir portada del dispositivo<input type="file" accept="image/*" onChange={handlePortalCover}/></label><small>En esta demo: JPG, PNG o WebP de hasta 1,5 MB.</small></section>
                </div>
                <div className="admin-form-grid admin-portal-copy-fields">
                  <label className="wide">Texto superior<input value={portalSettings.eyebrow} onChange={(event) => updatePortalSetting("eyebrow", event.target.value)}/></label>
                  <label>Título principal<input value={portalSettings.title} onChange={(event) => updatePortalSetting("title", event.target.value)}/></label>
                  <label>Frase destacada<input value={portalSettings.highlight} onChange={(event) => updatePortalSetting("highlight", event.target.value)}/></label>
                  <label className="wide">Descripción<textarea rows={3} value={portalSettings.description} onChange={(event) => updatePortalSetting("description", event.target.value)}/></label>
                </div>
              </article>

              <article className="admin-portal-section">
                <div className="admin-section-title"><span>02</span><div><h3>Información del local</h3><p>Estado, horarios y ubicación visibles al entrar.</p></div></div>
                <div className="admin-form-grid">
                  <label>Estado actual<input value={portalSettings.statusLabel} onChange={(event) => updatePortalSetting("statusLabel", event.target.value)}/></label>
                  <label>Detalle del estado<input value={portalSettings.statusDetail} onChange={(event) => updatePortalSetting("statusDetail", event.target.value)}/></label>
                  <label>Dirección<input value={portalSettings.address} onChange={(event) => updatePortalSetting("address", event.target.value)}/></label>
                  <label>Horarios<input value={portalSettings.hours} onChange={(event) => updatePortalSetting("hours", event.target.value)}/></label>
                </div>
                <div className="admin-portal-switches">
                  <label><input type="checkbox" checked={portalSettings.showStatus} onChange={(event) => updatePortalSetting("showStatus", event.target.checked)}/><span><strong>Mostrar estado</strong><small>Abierto, cerrado o servicio especial</small></span></label>
                  <label><input type="checkbox" checked={portalSettings.showAddress} onChange={(event) => updatePortalSetting("showAddress", event.target.checked)}/><span><strong>Mostrar dirección</strong><small>En el pie del portal</small></span></label>
                  <label><input type="checkbox" checked={portalSettings.showHours} onChange={(event) => updatePortalSetting("showHours", event.target.checked)}/><span><strong>Mostrar horarios</strong><small>Días y franja de atención</small></span></label>
                </div>
              </article>

              <article className="admin-portal-section">
                <div className="admin-section-title"><span>03</span><div><h3>Accesos del cliente</h3><p>Editá textos, destinos, jerarquía, orden y visibilidad.</p></div></div>
                <div className="admin-portal-actions-list">{portalSettings.actions.map((action, index) => <article key={action.id} className={!action.visible ? "is-hidden" : ""}>
                  <header><div><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{action.label}</strong><small>{action.style === "featured" ? "Acción principal" : action.style === "card" ? "Tarjeta destacada" : "Acceso secundario"}</small></span></div><div><button onClick={() => movePortalAction(action.id, -1)} disabled={index === 0} aria-label={`Subir ${action.label}`}>↑</button><button onClick={() => movePortalAction(action.id, 1)} disabled={index === portalSettings.actions.length - 1} aria-label={`Bajar ${action.label}`}>↓</button><button className="remove" onClick={() => removePortalAction(action)} aria-label={`Eliminar ${action.label}`}>×</button></div></header>
                  <div className="admin-form-grid">
                    <label>Título<input value={action.label} onChange={(event) => updatePortalAction(action.id, { label: event.target.value })}/></label>
                    <label>Descripción<input value={action.description} onChange={(event) => updatePortalAction(action.id, { description: event.target.value })}/></label>
                    <label className="wide">Destino<input value={action.href} onChange={(event) => updatePortalAction(action.id, { href: event.target.value })} placeholder="/ruta o https://..."/></label>
                    <label>Presentación<select value={action.style} onChange={(event) => updatePortalAction(action.id, { style: event.target.value as PortalAction["style"] })}><option value="featured">Principal</option><option value="card">Tarjeta</option><option value="compact">Secundario</option></select></label>
                    <label>Ícono<select value={action.icon} onChange={(event) => updatePortalAction(action.id, { icon: event.target.value as PortalAction["icon"] })}><option value="menu">Menú</option><option value="calendar">Calendario</option><option value="pin">Ubicación</option><option value="wine">Vino</option><option value="cocktail">Cóctel</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="link">Enlace</option></select></label>
                  </div>
                  <label className="admin-action-visible"><input type="checkbox" checked={action.visible} onChange={(event) => updatePortalAction(action.id, { visible: event.target.checked })}/><span>Visible para el cliente</span></label>
                </article>)}</div>
                <button className="admin-add-portal-action" onClick={addPortalAction}>＋ Agregar otro acceso</button>
              </article>

              <div className="admin-portal-save"><span>Los cambios se ven en esta demostración después de guardar.</span><button onClick={savePortalSettings}>Guardar y publicar portal</button></div>
            </div>

            <aside className="admin-portal-preview">
              <header><span>VISTA PREVIA</span><a href="/portal" target="_blank">Abrir completa ↗</a></header>
              <div className="admin-phone-preview" style={{ "--preview-accent": appSettings.accentColor } as CSSProperties}>
                <img className="admin-preview-cover" src={portalSettings.coverImageUrl || appSettings.heroImageUrl} alt=""/>
                <div className="admin-preview-shade"/>
                <div className="admin-preview-content">
                  <img className="admin-preview-logo" src={appSettings.logoUrl} alt=""/>
                  {portalSettings.showStatus && <span className="admin-preview-status">● {portalSettings.statusLabel}</span>}
                  <p>{portalSettings.eyebrow}</p><h2>{portalSettings.title}<em>{portalSettings.highlight}</em></h2><small>{portalSettings.description}</small>
                  <div>{portalSettings.actions.filter((action) => action.visible).slice(0, 5).map((action) => <span className={`preview-${action.style}`} key={action.id}><b>{action.label}</b><i>↗</i></span>)}</div>
                </div>
              </div>
              <p>La vista previa se actualiza mientras editás. Guardá para aplicar los cambios en el portal público.</p>
            </aside>
          </div> : <div className="admin-adjustments-grid">
            <article className="admin-adjustment-card admin-business-settings">
              <div className="admin-adjustment-heading"><span>01</span><div><h2>Información básica</h2></div></div>
              <div className="admin-adjustment-form">
                <label>Correo de contacto<input type="email" value={appSettings.contactEmail} onChange={(event) => updateAppSetting("contactEmail", event.target.value)} placeholder="administracion@restaurante.com"/></label>
                <label>Teléfono / WhatsApp<input value={appSettings.phone} onChange={(event) => updateAppSetting("phone", event.target.value)} placeholder="+54 9…"/></label>
                <label className="wide">Horarios<input value={appSettings.hours ?? ""} onChange={(event) => updateAppSetting("hours" as keyof AppSettings, event.target.value)} placeholder="Ej. Lun a Vie 12–24 hs · Sáb y Dom 11–01 hs"/></label>
                <label>Moneda<select value={appSettings.currency} onChange={(event) => updateAppSetting("currency", event.target.value as AppSettings["currency"])}><option value="ARS">Peso argentino · ARS</option><option value="USD">Dólar · USD</option><option value="BRL">Real · BRL</option></select></label>
                <label>Idioma inicial<select value={appSettings.defaultLanguage} onChange={(event) => updateAppSetting("defaultLanguage", event.target.value)}><option value="es">Español</option><option value="pt">Português</option><option value="en">English</option><option value="fr">Français</option><option value="it">Italiano</option><option value="de">Deutsch</option></select></label>
              </div>
              <div className="admin-adjustment-actions"><button onClick={saveAppSettings}>Guardar información</button></div>
            </article>


            <article className="admin-adjustment-card">
              <div className="admin-adjustment-heading"><span>03</span><div><small>CONTROL DE ACCESO</small><h2>Token de QR</h2><p>Si configurás un token, solo podrán lanzar pedidos los clientes que hayan escaneado el QR de una mesa. Dejalo vacío para deshabilitar la restricción.</p></div></div>
              <div className="admin-adjustment-form">
                <label className="wide">Token secreto del QR<input value={appSettings.orderToken} onChange={(event) => updateAppSetting("orderToken", event.target.value)} placeholder="Ej. r10s2026 — letras y números, sin espacios"/></label>
                {appSettings.orderToken && <div className="admin-token-preview"><small>URL de ejemplo para imprimir en el QR:</small><code>{typeof window !== "undefined" ? window.location.origin : "https://menu.23rios.com"}/?t={appSettings.orderToken}</code></div>}
              </div>
              <div className="admin-adjustment-actions"><button onClick={saveAppSettings}>Guardar token</button></div>
            </article>

            <article className="admin-adjustment-card admin-security-card">
              <div className="admin-adjustment-heading"><span>05</span><div><small>SEGURIDAD</small><h2>Usuario y contraseña</h2><p>Cambiá las credenciales utilizadas para ingresar en este dispositivo.</p></div></div>
              <form className="admin-security-form" onSubmit={saveSecuritySettings}>
                <label>Usuario<input autoComplete="username" value={securityUsername} onChange={(event) => setSecurityUsername(event.target.value)}/></label>
                <label>Contraseña actual<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required/></label>
                <label>Nueva contraseña<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Dejar vacío para conservarla"/></label>
                <label>Confirmar contraseña<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}/></label>
                <p>La contraseña nueva debe tener al menos 6 caracteres. Nunca se muestra ni se guarda como texto visible.</p>
                <button type="submit">Actualizar acceso</button>
              </form>
            </article>

            <article className="admin-adjustment-card admin-session-card">
              <div className="admin-adjustment-heading"><span>06</span><div><small>SESIÓN ACTUAL</small><h2>Acceso del dispositivo</h2><p>La sesión permanece activa solamente en esta pestaña del navegador.</p></div></div>
              <div className="admin-session-info"><span>Usuario conectado</span><strong>{securityUsername}</strong><small>Al cerrar sesión será necesario volver a ingresar la contraseña.</small></div>
              <button className="admin-session-logout" onClick={logout}>Cerrar sesión administrativa</button>
            </article>
          </div>}
        </section>
      </div>
    </main>
  );
}
