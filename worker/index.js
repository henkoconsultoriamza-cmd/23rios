/**
 * Worker de automatización FUDO para 23 Ríos
 *
 * Flujo:
 * 1. Polling cada 10s a Supabase order_outbox buscando PENDING
 * 2. Por cada pedido pendiente, abre menu.fu.do/23rios/self-service con Puppeteer
 * 3. Agrega cada producto al carrito navegando la UI de FUDO
 * 4. Completa el formulario de checkout con los datos del cliente
 * 5. Confirma el pedido — FUDO lo recibe como si viniera de su propio menú
 */

const puppeteer = require("puppeteer");
const { createClient } = require("@supabase/supabase-js");

const FUDO_MENU_URL = "https://menu.fu.do/23rios/self-service";
const POLL_INTERVAL_MS = 10_000;
const LEASE_MS = 120_000; // 2 minutos de lease por pedido

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Polling principal ──────────────────────────────────────────────────────────
async function poll() {
  const now = new Date().toISOString();

  const { data: items, error } = await supabase
    .from("order_outbox")
    .select("id, order_id")
    .eq("status", "PENDING")
    .or(`leased_until.is.null,leased_until.lt.${now}`)
    .order("created_at", { ascending: true })
    .limit(3);

  if (error) {
    console.error("[worker] Error leyendo outbox:", error.message);
    return;
  }

  if (!items || items.length === 0) return;

  // Lease
  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  await supabase
    .from("order_outbox")
    .update({ status: "PROCESSING", leased_until: leaseUntil })
    .in("id", items.map((i) => i.id));

  for (const item of items) {
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
  }
}

// ── Procesar un pedido con Puppeteer ──────────────────────────────────────────
async function processOrder(orderId) {
  // 1. Obtener datos del pedido
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, table_session_id, customer_name, customer_phone, customer_email, status")
    .eq("id", orderId)
    .single();

  if (orderErr || !order) throw new Error(`Pedido ${orderId} no encontrado`);
  if (order.status === "REGISTERED") return; // ya procesado

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

  const mappedLines = (lines || []).filter((l) => l.fudo_product_id);
  if (mappedLines.length === 0) throw new Error(`Pedido ${orderId} sin productos mapeados a FUDO`);

  // 2. Abrir Puppeteer
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 }); // mobile
    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    );

    console.log(`[worker] Abriendo menú FUDO para pedido ${orderId}...`);
    await page.goto(FUDO_MENU_URL, { waitUntil: "networkidle2", timeout: 30000 });

    // 3. Agregar cada producto al carrito
    for (const line of mappedLines) {
      for (let i = 0; i < line.quantity; i++) {
        await addProductToCart(page, line.fudo_product_id, line.comment);
      }
    }

    // 4. Ir al carrito
    await goToCart(page);

    // 5. Ir a pagar
    await page.waitForSelector("button", { timeout: 10000 });
    const irAPagar = await page.$x("//button[contains(text(), 'Ir a pagar')]");
    if (irAPagar.length === 0) throw new Error("No se encontró botón 'Ir a pagar'");
    await irAPagar[0].click();
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});

    // 6. Completar formulario de checkout
    await fillCheckout(page, {
      nombre: order.customer_name || "Cliente",
      telefono: order.customer_phone || "",
      email: order.customer_email || "",
      mesa: session?.mesa_numero || "1",
      personas: String(session?.people || 1),
    });

    // 7. Confirmar pedido
    await confirmOrder(page);

    // 8. Actualizar estado en Supabase
    await supabase
      .from("orders")
      .update({ status: "REGISTERED" })
      .eq("id", orderId);

  } finally {
    await browser.close();
  }
}

// ── Agregar producto al carrito ────────────────────────────────────────────────
async function addProductToCart(page, fudoProductId, comment) {
  // Buscar el producto por su ID en la URL de detalle
  const productUrl = `${FUDO_MENU_URL}/products/${fudoProductId}`;
  await page.goto(productUrl, { waitUntil: "networkidle2", timeout: 20000 });

  // Esperar el botón "Agregar a mi pedido"
  await page.waitForSelector("button", { timeout: 10000 });

  // Si hay comentario, agregarlo
  if (comment) {
    const textarea = await page.$("textarea");
    if (textarea) {
      await textarea.type(comment);
    }
  }

  // Clic en "Agregar a mi pedido"
  const agregarBtn = await page.$x("//button[contains(text(), 'Agregar a mi pedido')]");
  if (agregarBtn.length === 0) throw new Error(`No se encontró 'Agregar a mi pedido' para producto ${fudoProductId}`);
  await agregarBtn[0].click();

  // Esperar que procese
  await page.waitForTimeout(1000);
}

// ── Ir al carrito ──────────────────────────────────────────────────────────────
async function goToCart(page) {
  await page.goto(`${FUDO_MENU_URL}/cart`, { waitUntil: "networkidle2", timeout: 20000 });
  await page.waitForTimeout(1000);
}

// ── Completar formulario de checkout ──────────────────────────────────────────
async function fillCheckout(page, { nombre, telefono, email, mesa, personas }) {
  await page.waitForSelector("input", { timeout: 10000 });

  // Limpiar y completar cada campo buscando por label
  await fillField(page, "Nombre y apellido", nombre);
  await fillField(page, "Correo electrónico", email);
  await fillField(page, "Número de mesa", mesa);
  await fillField(page, "Cantidad de personas", personas);

  // El teléfono tiene un selector de país — completar solo el número
  if (telefono) {
    const inputs = await page.$$("input[type='tel'], input[type='phone']");
    if (inputs.length > 0) {
      await inputs[0].click({ clickCount: 3 });
      await inputs[0].type(telefono);
    }
  }
}

async function fillField(page, labelText, value) {
  if (!value) return;
  try {
    // Buscar input asociado al label
    const labels = await page.$x(`//label[contains(text(), '${labelText}')]`);
    if (labels.length > 0) {
      const forAttr = await labels[0].evaluate((el) => el.getAttribute("for"));
      if (forAttr) {
        const input = await page.$(`#${forAttr}`);
        if (input) {
          await input.click({ clickCount: 3 });
          await input.type(String(value));
          return;
        }
      }
    }
    // Fallback: buscar por placeholder
    const input = await page.$(`input[placeholder*="${labelText}"]`);
    if (input) {
      await input.click({ clickCount: 3 });
      await input.type(String(value));
    }
  } catch (e) {
    console.warn(`[worker] No se pudo completar campo "${labelText}":`, e.message);
  }
}

// ── Confirmar pedido ───────────────────────────────────────────────────────────
async function confirmOrder(page) {
  const confirmarBtn = await page.$x("//button[contains(text(), 'Confirmar pedido')]");
  if (confirmarBtn.length === 0) throw new Error("No se encontró botón 'Confirmar pedido'");
  await confirmarBtn[0].click();
  // Esperar confirmación
  await page.waitForTimeout(3000);
  console.log("[worker] Pedido confirmado en FUDO");
}

// ── Servidor HTTP mínimo para que Render no cierre el proceso ─────────────────
const http = require("http");
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("worker ok");
}).listen(PORT, () => {
  console.log(`[worker] HTTP escuchando en puerto ${PORT}`);
});

// ── Loop principal ─────────────────────────────────────────────────────────────
async function main() {
  console.log("[worker] Iniciando worker 23 Ríos → FUDO");
  console.log(`[worker] Polling cada ${POLL_INTERVAL_MS / 1000}s`);

  // Poll inmediato al arrancar
  await poll().catch(console.error);

  setInterval(async () => {
    await poll().catch(console.error);
  }, POLL_INTERVAL_MS);
}

main();
