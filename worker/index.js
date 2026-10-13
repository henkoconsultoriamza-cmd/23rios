/**
 * Worker de automatización FUDO para 23 Ríos
 *
 * Arquitectura:
 * - Puppeteer mantiene UNA pestaña caliente solo para gestionar la sesión FUDO
 * - Las cookies se extraen de esa pestaña y se usan en fetch() nativo de Node.js
 * - Todos los pedidos se procesan en paralelo con fetch directo — sin límite de concurrencia
 * - Las cookies se renuevan cada COOKIE_REFRESH_MS para mantener la sesión viva
 */

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const { createClient } = require("@supabase/supabase-js");

const FUDO_MENU_URL = "https://menu.fu.do/23rios/self-service";
const FUDO_ORDERS_URL = "https://integrations.fu.do/fudo/orders/";
const FUDO_PRODUCTS_URL = "https://integrations.fu.do/fudo/products/?a=23rios";
const POLL_INTERVAL_MS = 3_000;
const LEASE_MS = 120_000;
const COOKIE_REFRESH_MS = 8 * 60 * 1000; // renovar sesión cada 8 minutos

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Estado compartido ──────────────────────────────────────────────────────────
let sharedBrowser = null;
let warmPage = null;
let sessionCookieHeader = null;   // string listo para usar en header Cookie
let fudoProductsCache = null;
let lastCookieRefresh = 0;

// ── Browser ────────────────────────────────────────────────────────────────────
async function getBrowser() {
  if (!sharedBrowser || !sharedBrowser.connected) {
    console.log("[worker] Iniciando Chrome...");
    sharedBrowser = await puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    console.log("[worker] Chrome listo");
    warmPage = null;
  }
  return sharedBrowser;
}

// ── Sesión FUDO ────────────────────────────────────────────────────────────────
async function refreshSession() {
  const browser = await getBrowser();

  if (!warmPage || warmPage.isClosed()) {
    console.log("[worker] Calentando pestaña FUDO...");
    warmPage = await browser.newPage();
    await warmPage.setViewport({ width: 390, height: 844 });
    await warmPage.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    );
    await warmPage.goto(FUDO_MENU_URL, { waitUntil: "networkidle2", timeout: 45000 });
    await warmPage.waitForTimeout(5000);
  } else {
    // Ping silencioso para mantener la sesión viva
    try {
      await warmPage.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await warmPage.waitForTimeout(3000);
    } catch (e) {
      console.warn("[worker] Error en reload, recreando página:", e.message);
      warmPage = null;
      return refreshSession();
    }
  }

  // Extraer token de sesión desde localStorage (FUDO usa JWT, no cookies)
  const sessionData = await warmPage.evaluate(() => {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      data[key] = localStorage.getItem(key);
    }
    return data;
  }).catch(() => ({}));

  console.log(`[worker] localStorage keys: ${Object.keys(sessionData).join(", ") || "(vacío)"}`);

  // Buscar token JWT en localStorage
  const tokenKey = Object.keys(sessionData).find(k =>
    k.toLowerCase().includes("token") || k.toLowerCase().includes("auth") || k.toLowerCase().includes("session")
  );
  if (tokenKey) {
    sessionCookieHeader = `token=${sessionData[tokenKey]}`;
    console.log(`[worker] Token encontrado en key: ${tokenKey}`);
  } else {
    sessionCookieHeader = null;
    console.warn("[worker] No se encontró token de sesión en localStorage");
  }

  lastCookieRefresh = Date.now();

  // Catálogo solo la primera vez
  if (!fudoProductsCache) {
    fudoProductsCache = await warmPage.evaluate(async (url) => {
      const res = await fetch(url);
      return res.json();
    }, FUDO_PRODUCTS_URL);
    console.log(`[worker] Catálogo FUDO: ${fudoProductsCache?.length ?? 0} productos`);
  }
}

async function ensureSession() {
  const stale = Date.now() - lastCookieRefresh > COOKIE_REFRESH_MS;
  const noSession = !sessionCookieHeader || sessionCookieHeader.length === 0;
  if (noSession || stale) {
    await refreshSession();
  }
}

// ── Polling principal ──────────────────────────────────────────────────────────
async function poll() {
  await ensureSession();

  const { data: items, error } = await supabase
    .from("order_outbox")
    .select("id, order_id")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[worker] Error leyendo outbox:", JSON.stringify(error));
    return;
  }

  if (!items || items.length === 0) return;
  console.log(`[worker] ${items.length} pedidos PENDING — procesando en paralelo`);

  // Lease de todos juntos
  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  await supabase
    .from("order_outbox")
    .update({ status: "PROCESSING", leased_until: leaseUntil })
    .in("id", items.map(i => i.id));

  // Procesar todos en paralelo — fetch nativo Node.js, sin límite de concurrencia
  await Promise.all(items.map(async (item) => {
    try {
      await processOrder(item.order_id);
      await supabase
        .from("order_outbox")
        .update({ status: "DONE", leased_until: null })
        .eq("id", item.id);
      console.log(`[worker] ✓ Pedido ${item.order_id} enviado a FUDO`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[worker] ✗ Error en pedido ${item.order_id}:`, msg);
      await supabase
        .from("order_outbox")
        .update({ status: "ERROR", leased_until: null, error_message: msg })
        .eq("id", item.id);
    }
  }));
}

// ── Procesar un pedido ─────────────────────────────────────────────────────────
async function processOrder(orderId) {
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, table_session_id, customer_name, customer_phone, status")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) throw new Error(`Pedido ${orderId} no encontrado`);
  if (order.status === "REGISTERED") return;

  const { data: session } = await supabase
    .from("table_sessions")
    .select("mesa_numero, people")
    .eq("id", order.table_session_id)
    .single();

  const { data: lines } = await supabase
    .from("order_lines")
    .select("fudo_product_id, quantity, comment")
    .eq("order_id", orderId)
    .is("parent_line_id", null);

  const fudoItems = (lines || [])
    .filter(l => l.fudo_product_id)
    .map(l => {
      const fProd = (fudoProductsCache || []).find(p => String(p.id) === String(l.fudo_product_id));
      return {
        subitems: [],
        price: fProd?.price ?? 0,
        productCategoryId: fProd?.categoryId ?? fProd?.category?.id ?? fProd?.productCategoryId ?? 0,
        productId: parseInt(l.fudo_product_id),
        quantity: l.quantity,
      };
    });

  if (fudoItems.length === 0) throw new Error(`Pedido ${orderId} sin productos mapeados a FUDO`);

  const payload = {
    order: {
      customer: {
        dataCollectionEnabled: false,
        name: order.customer_name || "Cliente",
        phone: order.customer_phone || "",
      },
      items: fudoItems,
      payment: { method: "cash" },
      tableNumber: parseInt(session?.mesa_numero || "1"),
      people: session?.people || 1,
    }
  };

  console.log(`[worker] POST pedido ${orderId} → FUDO (${fudoItems.length} items, mesa ${session?.mesa_numero})`);

  // Fetch directo desde Node.js con las cookies de sesión
  const res = await fetch(FUDO_ORDERS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": sessionCookieHeader,
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Origin": "https://menu.fu.do",
      "Referer": FUDO_MENU_URL,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  console.log(`[worker] FUDO response pedido ${orderId}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);

  if (res.status === 401) {
    // Sesión expirada — forzar renovación y reintentar una vez
    console.log("[worker] 401 — renovando sesión y reintentando...");
    await refreshSession();
    const retry = await fetch(FUDO_ORDERS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": sessionCookieHeader,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Origin": "https://menu.fu.do",
        "Referer": FUDO_MENU_URL,
      },
      body: JSON.stringify(payload),
    });
    const retryBody = await retry.json().catch(() => ({}));
    if (retry.status < 200 || retry.status >= 300) {
      throw new Error(`FUDO rechazó pedido tras renovar sesión: HTTP ${retry.status} — ${JSON.stringify(retryBody).slice(0, 300)}`);
    }
  } else if (res.status < 200 || res.status >= 300) {
    throw new Error(`FUDO rechazó pedido: HTTP ${res.status} — ${JSON.stringify(body).slice(0, 300)}`);
  }

  await supabase
    .from("orders")
    .update({ status: "REGISTERED" })
    .eq("id", orderId);
}

// ── Servidor HTTP ──────────────────────────────────────────────────────────────
const http = require("http");
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  const path = (req.url?.split("?")[0] || "").replace(/\/$/, "") || "/";
  if (path === "/products" && fudoProductsCache) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(fudoProductsCache, null, 2));
  } else if (path === "/products") {
    res.writeHead(503);
    res.end("Catálogo aún no cargado");
  } else if (path === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      session: !!sessionCookieHeader,
      catalog: fudoProductsCache?.length ?? 0,
      lastRefresh: new Date(lastCookieRefresh).toISOString(),
    }));
  } else {
    res.writeHead(200);
    res.end(`worker ok | session=${!!sessionCookieHeader} | cache=${fudoProductsCache?.length ?? "null"}`);
  }
}).listen(PORT, () => {
  console.log(`[worker] HTTP en puerto ${PORT}`);
});

// ── Arranque ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("[worker] Iniciando worker 23 Ríos → FUDO");

  await refreshSession().catch(e => console.error("[worker] Error al calentar sesión inicial:", e?.message));

  await poll().catch(console.error);

  setInterval(async () => {
    await poll().catch(console.error);
  }, POLL_INTERVAL_MS);
}

main();
