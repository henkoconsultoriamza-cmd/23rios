# Menú restaurante

Plantilla PWA reutilizable para presentar un menú digital interactivo a distintos restaurantes. La identidad de demostración inicial es **Casa Numa**.

## Funciones incluidas

- Menú móvil con filtros de comida, bebidas, preferencias y alérgenos.
- Fotografías, precios, información nutricional y productos relacionados.
- Características y tamaños para cervezas.
- Mozo digital, carrito, número de mesa e historial de pedidos.
- Agenda de experiencias y selector de seis idiomas.
- Panel administrativo para productos, filtros, precios y cross-selling.
- Ajustes de marca para cambiar nombre, logo, portada, color y textos principales.

## Panel administrativo

- Ruta: `/admin`
- Usuario inicial: `admin`
- Contraseña inicial: `menu2026`

Los cambios del prototipo se guardan localmente en el navegador. Para un uso real multiusuario se debe conectar una base de datos y almacenamiento compartido.

## Desarrollo

Requiere Node.js `>=22.13.0`.

```bash
npm install
npm run dev
npm run build
```

---

## Integración con FUDO POS — 23 Ríos

### Naturaleza de la integración

**Esta NO es una integración oficial ni nativa de FUDO.**

Es una adaptación desarrollada por Henko Consultoría mediante ingeniería inversa del menú QR propio de FUDO. Se descubrió que el frontend del menú QR de FUDO realiza llamadas a un endpoint interno (`https://integrations.fu.do/fudo/orders/`) que acepta pedidos sin autenticación por token, usando únicamente un identificador de cuenta estático en los headers.

FUDO no documenta este endpoint, no ofrece soporte sobre él y puede modificarlo o eliminarlo sin previo aviso.

**23 Ríos está al tanto de esta condición y acepta el riesgo operativo que implica.**

### Cómo funciona

Cuando un cliente escanea el QR de nuestro menú (uno por mesa, con `?mesa=N` en la URL), y confirma su pedido:

1. Nuestro backend guarda el pedido en Supabase.
2. El worker (`/api/fudo-worker`) toma el pedido de la cola y lo envía a FUDO.
3. FUDO recibe el pedido como si hubiera sido generado por su propio menú QR.
4. El pedido aparece en cocina sin diferencia visible.

### Endpoint descubierto

```
POST https://integrations.fu.do/fudo/orders/
Headers:
  fudo-account-id: MjNyaW9z   ← base64 de "23rios", estático
  fudo-app: self-service
  content-type: application/json
  origin: https://menu.fu.do

Body:
{
  "order": {
    "customer": { "name": "...", "phone": "...", "email": "..." },
    "items": [
      { "productId": 607, "productCategoryId": 75, "price": 4500, "quantity": 1, "subitems": [] }
    ],
    "payment": { "total": 7500 },
    "shippingCost": 0,
    "type": "self-service",
    "tableNumber": 5,
    "people": 2
  }
}
```

### Riesgos conocidos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| FUDO cambia el endpoint o headers | Media | Alto — pedidos no llegan a cocina | Monitoreo de errores en el outbox; alertas al admin |
| FUDO agrega autenticación al endpoint | Baja | Alto | Requiere nueva investigación de red |
| Pedido guardado en nuestro sistema pero no enviado a FUDO | Siempre posible | Medio | El outbox permite reintentos manuales desde el panel admin |
| FUDO detecta tráfico automatizado y bloquea | Baja | Alto | Cada pedido sale desde la IP del cliente (navegador), no del servidor |

### Qué hacer si se rompe

1. Abrir Chrome en el local, escanear el QR de FUDO en una mesa.
2. Hacer un pedido de prueba con DevTools → Network → Fetch/XHR activo.
3. Capturar el nuevo request `POST` al confirmar y comparar con el endpoint documentado arriba.
4. Actualizar `/api/fudo-worker` con los cambios detectados.

### Datos que NO cambian (estables)

- `fudo-account-id: MjNyaW9z` — es base64 de `"23rios"`, ligado al nombre de cuenta del local en FUDO.
- El mapeo `productId` / `productCategoryId` de cada producto — está en `app/menu-data.ts` en el campo `fudoData` de cada producto.

### Responsable técnico

Henko Consultoría — henkoconsultoriamza@gmail.com
