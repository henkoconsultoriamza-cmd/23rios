/**
 * Worker de automatización FUDO para 23 Ríos
 */

const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const { createClient } = require("@supabase/supabase-js");

const FUDO_MENU_URL = "https://menu.fu.do/23rios/self-service";
const FUDO_ORDERS_URL = "https://integrations.fu.do/fudo/orders/";
const POLL_INTERVAL_MS = 3_000;
const LEASE_MS = 120_000;

// productId → { categoryId, price } — datos capturados de payloads reales de FUDO
const FUDO_CATALOG = {
  "22":   { categoryId: 70,  price: 5000 },
  "516":  { categoryId: 70,  price: 4500 },
  "77":   { categoryId: 70,  price: 14500 },
  "21":   { categoryId: 71,  price: 5000 },
  "518":  { categoryId: 71,  price: 4500 },
  "76":   { categoryId: 71,  price: 14500 },
  "25":   { categoryId: 73,  price: 5500 },
  "517":  { categoryId: 73,  price: 4700 },
  "81":   { categoryId: 73,  price: 15500 },
  "24":   { categoryId: 72,  price: 4500 },
  "356":  { categoryId: 72,  price: 4500 },
  "75":   { categoryId: 72,  price: 14500 },
  "23":   { categoryId: 74,  price: 5000 },
  "78":   { categoryId: 74,  price: 14500 },
  "607":  { categoryId: 75,  price: 4500 },
  "740":  { categoryId: 70,  price: 3700 },
  "741":  { categoryId: 71,  price: 3700 },
  "742":  { categoryId: 72,  price: 3500 },
  "743":  { categoryId: 73,  price: 3700 },
  "744":  { categoryId: 74,  price: 3700 },
  "878":  { categoryId: 75,  price: 3200 },
  "618":  { categoryId: 75,  price: 14500 },
  "1155": { categoryId: 79,  price: 5000 },
  "1159": { categoryId: 99,  price: 3000 },
  "1160": { categoryId: 99,  price: 3000 },
  "527":  { categoryId: 98,  price: 3500 },
  "12":   { categoryId: 98,  price: 3500 },
  "529":  { categoryId: 98,  price: 3500 },
  "172":  { categoryId: 98,  price: 3000 },
  "13":   { categoryId: 98,  price: 3000 },
  "699":  { categoryId: 98,  price: 10500 },
  "811":  { categoryId: 98,  price: 10500 },
  "330":  { categoryId: 98,  price: 9000 },
  "102":  { categoryId: 98,  price: 10500 },
  "979":  { categoryId: 97,  price: 3500 },
  "980":  { categoryId: 97,  price: 3500 },
  "1002": { categoryId: 97,  price: 3500 },
  "129":  { categoryId: 11,  price: 9000 },
  "84":   { categoryId: 11,  price: 6000 },
  "1167": { categoryId: 12,  price: 14000 },
  "1507": { categoryId: 12,  price: 18000 },
  "1508": { categoryId: 12,  price: 14000 },
  "1510": { categoryId: 12,  price: 14000 },
  "39":   { categoryId: 121, price: 8000 },
  "43":   { categoryId: 121, price: 9900 },
  "165":  { categoryId: 121, price: 10200 },
  "41":   { categoryId: 121, price: 7000 },
  "42":   { categoryId: 121, price: 8900 },
  "44":   { categoryId: 121, price: 7100 },
  "86":   { categoryId: 121, price: 8500 },
  "523":  { categoryId: 121, price: 12700 },
  "38":   { categoryId: 121, price: 7600 },
  "37":   { categoryId: 121, price: 9400 },
  "51":   { categoryId: 121, price: 7200 },
  "1094": { categoryId: 121, price: 7200 },
  "1308": { categoryId: 121, price: 8500 },
  "1310": { categoryId: 121, price: 9500 },
  "561":  { categoryId: 10,  price: 7500 },
  "1555": { categoryId: 10,  price: 7500 },
  "166":  { categoryId: 13,  price: 78000 },
  "49":   { categoryId: 13,  price: 70000 },
  "233":  { categoryId: 13,  price: 74000 },
  "148":  { categoryId: 13,  price: 74000 },
  "191":  { categoryId: 13,  price: 60000 },
  "329":  { categoryId: 118, price: 13500 },
  "1542": { categoryId: 118, price: 28200 },
  "46":   { categoryId: 118, price: 11700 },
  "1121": { categoryId: 118, price: 15500 },
  "218":  { categoryId: 90,  price: 8500 },
  "1066": { categoryId: 90,  price: 9500 },
  "920":  { categoryId: 90,  price: 12000 },
  "180":  { categoryId: 22,  price: 10200 },
  "1477": { categoryId: 22,  price: 14100 },
  "1317": { categoryId: 64,  price: 5000 },
  "1318": { categoryId: 64,  price: 2700 },
  "1320": { categoryId: 63,  price: 12500 },
  "1321": { categoryId: 63,  price: 13700 },
  "55":   { categoryId: 80,  price: 10800 },
  "1316": { categoryId: 80,  price: 41000 },
  "1325": { categoryId: 83,  price: 15000 },
  "1326": { categoryId: 83,  price: 15600 },
  "1476": { categoryId: 83,  price: 15500 },
  "1373": { categoryId: 84,  price: 27700 },
  "1330": { categoryId: 21,  price: 17500 },
  "1331": { categoryId: 21,  price: 25100 },
  "1375": { categoryId: 21,  price: 19600 },
  "1333": { categoryId: 21,  price: 24300 },
  "1225": { categoryId: 125, price: 13200 },
  "1366": { categoryId: 125, price: 10800 },
  "1422": { categoryId: 125, price: 12300 },
  "1423": { categoryId: 125, price: 13500 },
  "1511": { categoryId: 125, price: 2600 },
  "1512": { categoryId: 125, price: 2600 },
  "1513": { categoryId: 83, price: 15000 },
  "1515": { categoryId: 125, price: 14800 },
  "1516": { categoryId: 125, price: 27000 },
  "1517": { categoryId: 125, price: 9900 },
  "1518": { categoryId: 125, price: 27000 },
  "1519": { categoryId: 125, price: 14800 },
  "1521": { categoryId: 125, price: 14900 },
  "1487": { categoryId: 129, price: 10100 },
  "1523": { categoryId: 129, price: 18000 },
  "1334": { categoryId: 4,   price: 6500 },
  "1335": { categoryId: 4,   price: 6500 },
  "1010": { categoryId: 4,   price: 6500 },
  "1471": { categoryId: 4,   price: 6500 },
  "1544": { categoryId: 4,   price: 6500 },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

let sharedBrowser = null;
let warmPage = null;

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

async function getWarmPage() {
  const browser = await getBrowser();
  if (warmPage && !warmPage.isClosed()) return warmPage;

  console.log("[worker] Calentando pestaña FUDO...");
  warmPage = await browser.newPage();
  await warmPage.setViewport({ width: 390, height: 844 });
  await warmPage.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  );
  // Capturar token de sesión de las respuestas de FUDO durante inicialización
  let fudoSessionToken = null;
  await warmPage.setRequestInterception(true);
  warmPage.on("request", req => req.continue());

  await warmPage.goto(FUDO_MENU_URL, { waitUntil: "networkidle2", timeout: 45000 });
  await warmPage.waitForTimeout(3000);
  console.log("[worker] Pestaña caliente lista");
  return warmPage;
}

// ── Polling ────────────────────────────────────────────────────────────────────
async function poll() {
  const now = new Date().toISOString();

  const { data: items, error } = await supabase
    .from("order_outbox")
    .select("id, order_id")
    .eq("status", "PENDING")
    .or(`leased_until.is.null,leased_until.lt.${now}`)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) { console.error("[worker] Error outbox:", error.message); return; }
  if (!items || items.length === 0) return;

  console.log(`[worker] ${items.length} pedidos PENDING`);

  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  await supabase
    .from("order_outbox")
    .update({ status: "PROCESSING", leased_until: leaseUntil })
    .in("id", items.map(i => i.id));

  let done = 0, errors = 0;
  const tCiclo = Date.now();
  await Promise.all(items.map(async (item) => {
    try {
      await processOrder(item.order_id);
      await supabase.from("order_outbox").update({ status: "DONE", leased_until: null }).eq("id", item.id);
      done++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[worker] ✗ ${item.order_id}: ${msg}`);
      await supabase.from("order_outbox").update({ status: "ERROR", leased_until: null, error_message: msg }).eq("id", item.id);
      errors++;
    }
  }));

  console.log(`[worker] ciclo: ${done} ok${errors ? `, ${errors} errores` : ""} — ${((Date.now() - tCiclo) / 1000).toFixed(1)}s`);
}

// ── Procesar pedido ────────────────────────────────────────────────────────────
async function processOrder(orderId) {
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, table_session_id, customer_name, customer_phone, status")
    .eq("id", orderId).single();

  if (orderErr || !order) throw new Error(`Pedido ${orderId} no encontrado`);
  if (order.status === "REGISTERED") return;

  const { data: session } = await supabase
    .from("table_sessions").select("mesa_numero, fudo_table_id, people").eq("id", order.table_session_id).single();

  const { data: lines } = await supabase
    .from("order_lines").select("fudo_product_id, quantity, comment")
    .eq("order_id", orderId).is("parent_line_id", null);

  const fudoItems = (lines || [])
    .filter(l => l.fudo_product_id)
    .map(l => {
      const cat = FUDO_CATALOG[String(l.fudo_product_id)] || { categoryId: 0, price: 0 };
      return {
        subitems: [],
        price: cat.price,
        productCategoryId: cat.categoryId,
        productId: parseInt(l.fudo_product_id),
        quantity: l.quantity,
      };
    });

  if (fudoItems.length === 0) throw new Error(`Pedido ${orderId} sin productos mapeados`);

  const total = fudoItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const payload = {
    order: {
      customer: {
        dataCollectionEnabled: false,
        name: order.customer_name || "Cliente",
        phone: order.customer_phone || "",
      },
      items: fudoItems,
      payment: { total },
      people: session?.people || 1,
      shippingCost: 0,
      tableNumber: parseInt(session?.fudo_table_id || session?.mesa_numero || "1"),
      type: "self-service",
      typeOptions: {},
    }
  };


  const FUDO_HEADERS = {
    "Content-Type": "application/json",
    "fudo-app": "self-service",
    "fudo-account-id": "MjNyaW9z",
    "origin": "https://menu.fu.do",
    "referer": "https://menu.fu.do/",
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "accept": "application/json, text/plain, */*",
  };

  const res = await fetch(FUDO_ORDERS_URL, {
    method: "POST",
    headers: FUDO_HEADERS,
    body: JSON.stringify(payload),
  });

  if (res.status < 200 || res.status >= 300) {
    const resBody = await res.json().catch(() => ({}));
    throw new Error(`FUDO HTTP ${res.status}: ${JSON.stringify(resBody).slice(0, 150)}`);
  }

  await supabase.from("orders").update({ status: "REGISTERED" }).eq("id", orderId);
}

// ── HTTP ───────────────────────────────────────────────────────────────────────
const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("worker ok");
}).listen(PORT, () => console.log(`[worker] HTTP en puerto ${PORT}`));

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[worker] Iniciando worker 23 Ríos → FUDO v10");
  await getWarmPage().catch(e => console.error("[worker] Error calentando página:", e?.message));
  await poll().catch(console.error);
  setInterval(() => poll().catch(console.error), POLL_INTERVAL_MS);
}

main();
