// Cliente server-side para la API de Fudo.
// Solo se ejecuta en el servidor (API routes / Edge Functions).
// NUNCA se importa desde componentes de cliente.

import type {
  FudoAuthResponse,
  FudoSaleDoc,
  FudoItemDoc,
  CreateSaleBody,
  CreateItemBody,
} from "./types";

const BASE_URL = process.env.FUDO_BASE_URL ?? "https://api.fu.do/v1alpha1";
const AUTH_URL = process.env.FUDO_AUTH_URL ?? "https://auth.fu.do/api";
const API_KEY = process.env.FUDO_API_KEY!;
const API_SECRET = process.env.FUDO_API_SECRET!;

// ─── Token cache (en memoria, válido por proceso) ─────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0; // epoch segundos

async function getToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  // Renovar con 60 segundos de margen antes del vencimiento
  if (cachedToken && nowSec < tokenExpiresAt - 60) return cachedToken;

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ apiKey: API_KEY, apiSecret: API_SECRET }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new FudoError(`Auth failed ${res.status}: ${body}`, res.status);
  }

  const data: FudoAuthResponse = await res.json();
  cachedToken = data.token;
  tokenExpiresAt = data.exp;
  return cachedToken;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export class FudoError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "FudoError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });

  const body = await res.text();
  if (!res.ok) {
    throw new FudoError(
      `Fudo ${options.method ?? "GET"} ${path} → ${res.status}: ${body}`,
      res.status
    );
  }
  return JSON.parse(body) as T;
}

// ─── Sales ────────────────────────────────────────────────────────────────────

/**
 * Abre una cuenta nueva en Fudo para la mesa indicada.
 * Devuelve el objeto Sale completo con su ID.
 */
export async function createSale(body: CreateSaleBody): Promise<FudoSaleDoc> {
  return request<FudoSaleDoc>("/sales", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Lee el estado actual de una venta.
 * Útil para verificar que siga IN-COURSE antes de agregar ítems.
 */
export async function getSale(saleId: string): Promise<FudoSaleDoc> {
  return request<FudoSaleDoc>(`/sales/${saleId}`);
}

/**
 * Lista las ventas activas (IN-COURSE) de una mesa específica.
 * Se usa para detectar si ya hay una cuenta abierta antes de crear una nueva.
 */
export async function getActiveSalesForTable(
  fudoTableId: string
): Promise<FudoSaleDoc["data"][]> {
  const res = await request<{ data: FudoSaleDoc["data"][] }>(
    `/sales?filter[saleState]=in.(IN-COURSE)&filter[table]=eq.${fudoTableId}`
  );
  return res.data;
}

// ─── Items ────────────────────────────────────────────────────────────────────

/**
 * Agrega un ítem a una venta abierta.
 * Debe llamarse una vez por línea de pedido.
 */
export async function createItem(body: CreateItemBody): Promise<FudoItemDoc> {
  return request<FudoItemDoc>("/items", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Lee el estado de un ítem ya enviado.
 * Útil para verificar que quedó registrado correctamente.
 */
export async function getItem(itemId: string): Promise<FudoItemDoc> {
  return request<FudoItemDoc>(`/items/${itemId}`);
}

// ─── Tables ───────────────────────────────────────────────────────────────────

/**
 * Devuelve todas las mesas de Fudo con su número visible y su ID interno.
 * Se usa para poblar la tabla fudo_tables en Supabase.
 */
export async function getAllTables(): Promise<
  Array<{ id: string; number: number }>
> {
  const res = await request<{
    data: Array<{ id: string; attributes: { number: number } }>;
  }>("/tables?page[size]=500");
  return res.data.map((t) => ({ id: t.id, number: t.attributes.number }));
}
