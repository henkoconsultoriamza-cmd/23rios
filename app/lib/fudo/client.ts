/**
 * Fudo POS API client
 *
 * Auth:   POST https://auth.fu.do/api/auth  → JWT válido 24 h
 * Base:   https://api.fu.do/v1alpha1
 * Formato: JSON:API (application/vnd.api+json)
 *
 * Credenciales en .env.local:
 *   FUDO_API_KEY, FUDO_API_SECRET, FUDO_BASE_URL, FUDO_AUTH_URL
 */

// ── Token cache (en memoria, válido por proceso) ───────────────────────────────
let _token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _token.expiresAt - 60_000) return _token.value;

  const res = await fetch(`${process.env.FUDO_AUTH_URL}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: process.env.FUDO_API_KEY,
      apiSecret: process.env.FUDO_API_SECRET,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new FudoError(`Auth failed (${res.status})`, res.status, body);
  }

  const json = await res.json() as Record<string, unknown>;

  // Fudo puede responder con "token" o "access_token"
  const value = (json.token ?? json.access_token) as string;
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 86400;

  if (!value) throw new FudoError("Auth response sin token", res.status, JSON.stringify(json));

  _token = { value, expiresAt: Date.now() + expiresIn * 1000 };
  return value;
}

// ── Error tipado ───────────────────────────────────────────────────────────────
export class FudoError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "FudoError";
  }
}

// ── Fetch base ─────────────────────────────────────────────────────────────────
async function fudoFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const url = `${process.env.FUDO_BASE_URL}${path}`;

  const method = (init.method ?? "GET").toUpperCase();
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/vnd.api+json",
      "Accept": "application/vnd.api+json",
      "Authorization": `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    // cache: no-store solo en GET — en POST puede hacer que Next.js descarte el body
    ...(method === "GET" ? { cache: "no-store" } : {}),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new FudoError(
      `Fudo ${init.method ?? "GET"} ${path} → ${res.status}`,
      res.status,
      body,
    );
  }

  return res.json() as Promise<T>;
}

// ── Tipos Fudo ─────────────────────────────────────────────────────────────────
type FudoJsonApiResponse<Attrs> = {
  data: { id: string; type: string; attributes: Attrs };
};

type FudoTableAttrs = { number?: string; name?: string; active?: boolean };
type FudoTablesResponse = { data: { id: string; attributes: FudoTableAttrs }[] };

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * Devuelve todas las mesas del local desde Fudo.
 * Usar para sincronizar la tabla fudo_tables en Supabase.
 */
export async function getTables(): Promise<{ id: string; number: string; name?: string }[]> {
  const json = await fudoFetch<FudoTablesResponse>("/tables");
  return (json.data ?? []).map((t) => ({
    id: t.id,
    number: String(t.attributes?.number ?? t.id),
    name: t.attributes?.name,
  }));
}

/**
 * Abre una cuenta (Sale) en Fudo para la mesa indicada.
 * Retorna el saleId interno de Fudo.
 */
export async function createSale(fudoTableId: string, people: number): Promise<string> {
  const json = await fudoFetch<FudoJsonApiResponse<unknown>>("/sales", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "Sale",
        attributes: { saleType: "EAT-IN", people },
        relationships: {
          table: { data: { id: fudoTableId, type: "Table" } },
        },
      },
    }),
  });
  return json.data.id;
}

/**
 * Agrega un ítem a una venta abierta en Fudo.
 * Retorna el itemId asignado por Fudo.
 *
 * @param saleId        ID de la venta en Fudo (de createSale)
 * @param fudoProductId ID del producto en Fudo
 * @param quantity      Cantidad
 * @param unitPrice     Precio unitario en ARS (entero)
 * @param comment       Texto libre: ingredientes removidos, aclaraciones, etc.
 */
export async function addSaleItem(
  saleId: string,
  fudoProductId: string,
  quantity: number,
  unitPrice: number,
  comment?: string,
): Promise<string> {
  const attrs: Record<string, unknown> = { quantity, price: unitPrice };
  if (comment) attrs.comment = comment;

  const json = await fudoFetch<FudoJsonApiResponse<unknown>>(`/sales/${saleId}/items`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "SaleItem",
        attributes: attrs,
        relationships: {
          product: { data: { id: fudoProductId, type: "Product" } },
        },
      },
    }),
  });
  return json.data.id;
}

/**
 * Consulta el estado de una venta en Fudo.
 * Útil para detectar si la mesa está en cobro (PAYMENT-PROCESS).
 */
export async function getSaleStatus(saleId: string): Promise<string> {
  const json = await fudoFetch<FudoJsonApiResponse<{ state?: string }>>(`/sales/${saleId}`);
  return json.data.attributes.state ?? "UNKNOWN";
}
