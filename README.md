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
