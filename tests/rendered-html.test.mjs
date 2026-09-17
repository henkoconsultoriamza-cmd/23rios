import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://casa-numa.test${pathname}`, {
      headers: { accept: "text/html", host: "casa-numa.test", "x-forwarded-host": "casa-numa.test", "x-forwarded-proto": "https" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Casa Numa restaurant menu", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Casa Numa/);
  assert.match(html, /Sabores con intención/);
  assert.match(html, /Filet Numa/);
  assert.match(html, /Mis pedidos/);
  assert.doesNotMatch(html, /23 Ríos Craftbeer|Star Wars Fest/);
});

test("keeps rebrandable settings and restaurant assets ready", async () => {
  const catalogImages = [
    "burrata-estacion.png",
    "risotto-hongos.png",
    "texturas-chocolate.png",
    "malbec-reserva.png",
    "numa-spritz.png",
    "golden-ale.png",
    "agua-mineral.png",
  ];
  const [menuData, admin, packageJson] = await Promise.all([
    readFile(new URL("../app/menu-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    access(new URL("../public/images/casa-numa/logo-casa-numa.png", import.meta.url)),
    access(new URL("../public/images/casa-numa/hero-casa-numa.png", import.meta.url)),
    ...catalogImages.map((name) => access(new URL(`../public/images/casa-numa/${name}`, import.meta.url))),
  ]);
  assert.match(menuData, /accentColor/);
  assert.match(menuData, /logoUrl/);
  assert.match(menuData, /heroImageUrl/);
  assert.match(admin, /Aplicar identidad al menú/);
  for (const image of catalogImages) assert.match(menuData, new RegExp(image.replace(".", "\\.")));
  assert.match(packageJson, /"name": "menu-restaurante-rebrandable"/);
});
