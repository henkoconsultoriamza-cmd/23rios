# Estado del Menú Digital — 23 Ríos
*Última actualización: 5 de octubre de 2026*

---

## Proyecto

**Ruta local:** `Clientes\23 Rios\Menú ditial 23\`
**Stack:** Next.js 16 + React 19 + Supabase + Fudo POS
**Framework real:** Next.js con Cloudflare Workers (`.wrangler/` presente — revisar `AGENTS.md` antes de tocar rutas API)

---

## Arquitectura del flujo de pedidos

```
Cliente escanea QR → Menú digital (Next.js) → POST /api/orders → Supabase (orders + order_lines + order_outbox)
                                                                          ↓
                                                         POST /api/fudo-worker (worker manual/cron)
                                                                          ↓
                                                                    Fudo POS API
```

---

## Infraestructura

| Servicio | Estado | Detalle |
|---|---|---|
| Supabase | ✅ Conectado | URL real en `.env.local` |
| Fudo POS | ✅ Credenciales listas | API key, secret, base URL, auth URL en `.env.local` |
| Worker outbox → Fudo | ✅ Implementado | `app/api/fudo-worker/route.ts` |
| Cliente Fudo | ✅ Implementado | `app/lib/fudo/client.ts` |

### Variables de entorno (`.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
FUDO_API_KEY=MTMyQDQ4Njk4
FUDO_API_SECRET=y2eL2S30vrs6nv6QZVt6ELFnub5Y0jYV
FUDO_BASE_URL=https://api.fu.do/v1alpha1
FUDO_AUTH_URL=https://auth.fu.do/api
WORKER_SECRET=  ← (opcional) protege el endpoint del worker
```

---

## Tablas Supabase

| Tabla | Función |
|---|---|
| `orders` | Cabecera del pedido (status: RECEIVED → PROCESSING → REGISTERED) |
| `order_lines` | Líneas del pedido + modificadores como líneas hija (parent_line_id) |
| `table_sessions` | Sesión de mesa — incluye `fudo_sale_id` (ID de la cuenta en Fudo) |
| `order_outbox` | Cola del worker (status: PENDING → PROCESSING → DONE / ERROR) |
| `restaurant_config` | Config dinámica (key/value): incluye `promos` |
| `fudo_tables` | Mapeo mesa_numero → fudo_table_id (sincronizar via GET /tables de Fudo) |

### Migración pendiente de aplicar
Archivo: `supabase/migrations/add_fudo_columns.sql`

Agrega:
- `table_sessions.fudo_sale_id` — el Sale ID de Fudo para la sesión
- `order_lines.fudo_item_id` — el Item ID confirmado por Fudo
- `order_outbox.error_message` — detalle del error cuando status = ERROR
- Tabla `fudo_tables` — mapa mesa_numero → fudo_table_id

**⚠️ Ejecutar este SQL en Supabase antes de hacer pruebas reales.**

---

## Archivos clave

| Archivo | Qué hace |
|---|---|
| `app/lib/fudo/client.ts` | Cliente Fudo: auth JWT, createSale, addSaleItem, getSaleStatus, getTables |
| `app/api/fudo-worker/route.ts` | Worker: procesa order_outbox y envía a Fudo. GET = estado, POST = procesar |
| `app/api/orders/route.ts` | Recibe pedidos del cliente → Supabase + encola en outbox |
| `app/api/orders/[id]/route.ts` | Consulta estado de un pedido |
| `app/menu-data.ts` | Productos con `fudoData` cargado |
| `app/admin/page.tsx` | Panel admin con UI para editar fudoData por producto |
| `supabase/migrations/add_fudo_columns.sql` | SQL para aplicar en Supabase |

---

## Pasos para lanzar — checklist

### 1. Supabase (una sola vez)
- [ ] Ejecutar `supabase/migrations/add_fudo_columns.sql` en el SQL Editor
- [ ] Llenar la tabla `fudo_tables` con el mapeo de mesas:
  ```sql
  INSERT INTO fudo_tables (mesa_numero, fudo_table_id) VALUES
  ('1', '<ID_FUDO>'), ('2', '<ID_FUDO>'), ...;
  ```
  _(Los IDs se obtienen llamando a `GET https://api.fu.do/v1alpha1/tables` con el token)_

### 2. Verificar auth Fudo
```bash
curl -X POST https://auth.fu.do/api/auth \
  -H "Content-Type: application/json" \
  -d '{"api_key":"MTMyQDQ4Njk4","api_secret":"y2eL2S30vrs6nv6QZVt6ELFnub5Y0jYV"}'
```
→ Debe responder con un token JWT.

### 3. Primer pedido de prueba
1. Abrir el menú en dev (`npm run dev`)
2. Elegir una mesa y agregar un producto con fudoData mapeado
3. Confirmar el pedido → aparece en `order_outbox` con status PENDING
4. Disparar el worker: `POST /api/fudo-worker` (desde admin o curl)
5. Verificar en Fudo que aparece el pedido en la mesa

### 4. Cron (producción)
Configurar un cron que llame `POST /api/fudo-worker` cada 30–60 segundos.
Cloudflare Workers Cron o Vercel Cron Triggers son las opciones naturales para este stack.

---

## Catálogo — estado del mapeo Fudo

### Cervezas artesanales

| ID | Nombre | Tamaños mapeados en Fudo | Estado |
|---|---|---|---|
| `golden` | Golden | Pinta(22), Lata(516), Growler(77) | ✅ |
| `scottish` | Scottish | Pinta(21), Lata(518), Growler(76) | ✅ |
| `ipa` | IPA | Pinta(25), Lata(517), Growler(81) | ✅ |
| `stout` | Stout | Copa(24), Lata(356), Growler(75) | ✅ — sin servings en menu-data |
| `honey` | Honey | Pinta(23), Growler(78) | ✅ |
| `lager` | Lager | Pinta(607), Media pinta(878) | ⚠️ confirmar con 23 Ríos |
| `american-ipa` | American IPA | — | ❌ crear en Fudo |
| `orange-wheat` | Orange Wheat | — | ❌ crear en Fudo |

> **Pendiente con 23 Ríos:** confirmar si Media Pinta está habilitada para todas las cervezas (IDs 740–744) y si Stout tiene servings en el menú.

### Cocina (todos con `productId` en fudoData)

| ID | Nombre | ID Fudo | Estado |
|---|---|---|---|
| `papas-clasicas` | Papas clásicas | 1320 | ⚠️ confirmar |
| `papas-23-rios` | Papas 23 Ríos | 1321 | ⚠️ confirmar |
| `nuggets-brocoli` | Nuggets de Brócoli | 180 | ⚠️ confirmar |
| `picada` | Picada de fiambres | 55 | ✅ match exacto |
| `provoleta` | Provoleta Fundida | 1487 | ⚠️ confirmar |
| `general-tso` | Poderoso General Tso | 1477 | ⚠️ confirmar |
| `experiencia-alemana` | Experiencia Alemana | — | ❌ crear en Fudo |
| `pizza-muzzarella` | Muzzarella | 1330 | ✅ |
| `pizza-napolitana` | Napolitana | 1375 | ✅ |
| `pizza-calabresa` | Calabresa | 1331 | ✅ (price: 0) |
| `pizza-americana` | Americana | 1333 | ✅ (price: 0) |
| `smash-blue` | Smash Blue | 1326 | ✅ |
| `smash-doble-queso` | Smash doble queso | 1513 | ⚠️ confirmar (Fudo: "Sin tacc") |
| `smash-23` | Smash 23 | 1476 | ✅ |
| `lomo-clasico` | Lomo clásico 30 cm | 1373 | ✅ |
| `empanada-verdura` | Empanada de verdura | 1318 | ✅ |
| `empanadas-carne` | Dúo empanadas de carne | — | ❌ confirmar si usar x2 o crear combo |
| `kid-nuggets` | Nuggets Kid | 1485 | ✅ |
| `kid-hamburguesa` | Hamburguesa Cheese Kid | 1224 | ✅ |
| `birramisu` | Birramisu | 1334 | ✅ |
| `flan` | Flan | 1335 | ✅ |
| `lemon-pie` | Lemon Pie | 1010 | ✅ |
| `brownie` | Brownie | 1471 | ✅ |

### Bebidas (selección)

| ID | Nombre | ID Fudo | Estado |
|---|---|---|---|
| `fernet-branca` | Fernet Branca | 39 | ⚠️ confirmar |
| `aperol-spritz` | Aperol Spritz | 43 | ⚠️ confirmar |
| `cuba-libre` | Cuba Libre | 42 | ✅ |
| `vermouth-rosso` | Vermouth Rosso | 1094 | ⚠️ confirmar (Fudo: Carpano Rosso) |
| `cynar` | Cynar | 44 | ✅ match exacto |
| `mojito-clasico` | Mojito Clásico | 38 | ⚠️ confirmar |
| `mojito-malibu` | Mojito Malibú | 37 | ⚠️ confirmar |
| `campari` | Campari | 41 | ✅ |
| `gin-gordons` | Gin Gordon's | 86 | ✅ |
| `gin-beefeater` | Gin Beefeater | 165 | ✅ |
| `gin-bulldog` | Gin Bulldog | 523 | ✅ match exacto |
| `negroni` | Negroni | 51 | ✅ match exacto |
| `boulevardier` | Boulevardier | 1310 | ✅ |
| `garibaldi` | Garibaldi | 1376 | ✅ |
| `daiquiri` | Daiquiri | 1308 | ⚠️ confirmar |
| `prep-fernet` | Fernet + Coca | 329 | ⚠️ confirmar |
| `prep-ron` | Ron + Coca | 1121 | ⚠️ confirmar |
| `prep-vodka` | Vodka + Red Bull | — | ❌ crear combo en Fudo |
| `prep-jager` | Jäger + Red Bull | 1542 | ⚠️ confirmar |
| `whisky-red-label` | Red Label | 1066 | ✅ |
| `whisky-jim-beam` | Jim Beam | 218 | ✅ match exacto |
| `whisky-double-black` | Double Black | 920 | ✅ |
| `malbec` | Las Perdices Malbec | 1167 | ✅ |
| `cabernet-franc` | Cabernet Franc | 1510 | ✅ |
| `sauvignon-blanc` | Sauvignon Blanc | 1508 | ✅ |
| `reserva-malbec` | Reserva Malbec | 1507 | ✅ |
| `combo-fernet` | Fernet + Coca 2,25 lts | 49 | ⚠️ confirmar |
| `combo-ron` | Ron Havana + Coca 2,25 lts | 148 | ⚠️ confirmar |
| `combo-vodka` | Vodka Skyy + Sprite 2,25 lts | 191 | ⚠️ confirmar |
| `combo-gin-gordons` | Gin Gordon's + Tónica | 233 | ⚠️ confirmar |
| `combo-gin-beefeater` | Gin Beefeater + Tónica | 166 | ⚠️ confirmar |
| `coca-cola` | Coca Cola 500 ml | 527 | ✅ |
| `coca-zero` | Coca Zero 500 ml | 12 | ✅ |
| `sprite` | Sprite 500 ml | 529 | ✅ |
| `agua-saborizada` | Agua saborizada | — | ❌ identificar en Fudo |
| `tonica` | Lata tónica 268 ml | 13 | ⚠️ confirmar |
| `pomelo` | Lata pomelo 269 ml | 172 | ✅ |
| `agua` | Agua sin / con gas | 1159/1160 | ❌ dos productos en Fudo — decidir |
| `limonada` | Limonada | 84 | ✅ match exacto |
| `jarra-limonada` | Jarra de Limonada | 129 | ✅ (verificar precio) |

---

## Resumen del mapeo

| Estado | Cantidad |
|---|---|
| ✅ Mapeados y listos | ~35 |
| ⚠️ Mapeados pero pendientes de confirmación | ~20 |
| ❌ Sin mapeo — requieren acción en Fudo | 6 |

**6 productos sin mapeo:** american-ipa, orange-wheat, experiencia-alemana, empanadas-carne (dúo), prep-vodka, agua-saborizada, agua sin/con gas.

---

## Pendientes para completar el lanzamiento

| Prioridad | Tarea |
|---|---|
| 🔴 | Ejecutar migración SQL en Supabase |
| 🔴 | Verificar que el endpoint de auth Fudo responde correctamente |
| 🔴 | Llenar tabla `fudo_tables` con el mapeo de mesas del local |
| 🟡 | Confirmar los ⚠️ con 23 Ríos (nombres vs Fudo) |
| 🟡 | Crear los 6 productos ❌ en Fudo o decidir cómo mapearlos |
| 🟡 | Definir precios de pizza-calabresa y pizza-americana (price: 0) |
| 🟢 | Configurar cron que dispare el worker cada 30–60 s en producción |
| 🟢 | Agregar `WORKER_SECRET` a `.env.local` para proteger el endpoint |
