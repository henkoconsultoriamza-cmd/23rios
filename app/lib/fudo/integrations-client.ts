/**
 * Cliente para el endpoint interno del menú QR de FUDO.
 *
 * IMPORTANTE: Este NO es un endpoint oficial de FUDO.
 * Es el mismo que usa su propio menú QR internamente.
 * Descubierto mediante inspección de red el 2026-10-12.
 * Puede cambiar sin previo aviso — ver README.md para el protocolo de reparación.
 *
 * Endpoint: POST https://integrations.fu.do/fudo/orders/
 * Auth:     Header fudo-account-id (base64 del slug del local)
 */

const FUDO_INTEGRATIONS_URL = "https://integrations.fu.do/fudo/orders/";
const FUDO_ACCOUNT_ID = process.env.FUDO_ACCOUNT_ID ?? "MjNyaW9z"; // base64 de "23rios"

export type FudoIntegrationsItem = {
  productId: number;
  productCategoryId: number;
  price: number;
  quantity: number;
  subitems: unknown[];
};

export type FudoIntegrationsPayload = {
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  tableNumber: number;
  people?: number;
  items: FudoIntegrationsItem[];
  total: number;
};

export type FudoIntegrationsResult = {
  saleId: number;
  orderId: number;
  scheduled: boolean;
};

export class FudoIntegrationsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "FudoIntegrationsError";
  }
}

export async function sendOrderToFudo(
  payload: FudoIntegrationsPayload,
): Promise<FudoIntegrationsResult> {
  const body = {
    order: {
      customer: {
        dataCollectionEnabled: false,
        name: payload.customerName,
        phone: payload.customerPhone ?? "",
        email: payload.customerEmail ?? "",
      },
      items: payload.items.map((item) => ({
        subitems: item.subitems,
        price: item.price,
        productCategoryId: item.productCategoryId,
        productId: item.productId,
        quantity: item.quantity,
      })),
      payment: { total: payload.total },
      shippingCost: 0,
      typeOptions: {},
      type: "self-service",
      tableNumber: payload.tableNumber,
      people: payload.people ?? 1,
    },
  };

  const res = await fetch(FUDO_INTEGRATIONS_URL, {
    method: "POST",
    headers: {
      "accept": "application/json, text/plain, */*",
      "content-type": "application/json",
      "fudo-account-id": FUDO_ACCOUNT_ID,
      "fudo-app": "self-service",
      "origin": "https://menu.fu.do",
      "referer": "https://menu.fu.do/",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new FudoIntegrationsError(
      `FUDO integrations → ${res.status}`,
      res.status,
      text,
    );
  }

  return res.json() as Promise<FudoIntegrationsResult>;
}
