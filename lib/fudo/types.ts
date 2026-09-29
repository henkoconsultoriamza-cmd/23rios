// Tipos que Fudo devuelve y que enviamos — basados en exploración directa de la API (Sept 2026)

export interface FudoAuthResponse {
  token: string;
  exp: number; // segundos desde epoch
}

// ─── Sale ───────────────────────────────────────────────────────────────────

export type FudoSaleState =
  | "IN-COURSE"
  | "PAYMENT-PROCESS"
  | "CLOSED"
  | "CANCELED"
  | "PENDING"
  | "DELIVERY-SENT"
  | "READY-TO-DELIVER";

export interface FudoSaleAttributes {
  saleType: "EAT-IN" | "TAKEAWAY" | "DELIVERY";
  people: number;
  saleState: FudoSaleState;
  total: number;
  createdAt: string;
  closedAt: string | null;
  comment: string | null;
  customerName: string | null;
}

export interface FudoSaleDoc {
  data: {
    type: "Sale";
    id: string;
    attributes: FudoSaleAttributes;
    relationships: {
      table: { data: { type: "Table"; id: string } | null };
      items: { data: Array<{ type: "Item"; id: string }> };
    };
  };
}

// Body para POST /sales
export interface CreateSaleBody {
  data: {
    type: "Sale";
    attributes: {
      saleType: "EAT-IN";
      people: number;
    };
    relationships: {
      table: { data: { type: "Table"; id: string } };
    };
  };
}

// ─── Item ────────────────────────────────────────────────────────────────────

export interface FudoItemAttributes {
  quantity: number;
  price: number;
  comment: string | null;
  status: string | null;
  canceled: boolean | null;
  createdAt: string;
  paid: boolean;
}

export interface FudoItemDoc {
  data: {
    type: "Item";
    id: string;
    attributes: FudoItemAttributes;
    relationships: {
      product: { data: { type: "Product"; id: string } };
      sale: { data: { type: "Sale"; id: string } };
      subitems: { data: Array<{ type: "Item"; id: string }> };
    };
  };
}

// Body para POST /items
export interface CreateItemBody {
  data: {
    type: "Item";
    attributes: {
      quantity: number;
      price: number;
      comment?: string; // "Sin cebolla", "Sin tomate", etc.
    };
    relationships: {
      product: { data: { type: "Product"; id: string } };
      sale: { data: { type: "Sale"; id: string } };
    };
  };
}

// ─── Línea de pedido (nuestro dominio → Fudo) ────────────────────────────────

export interface OrderLineInput {
  fudoProductId: string;   // ID del producto en Fudo (ej: "1476")
  quantity: number;
  unitPrice: number;       // en pesos, número entero (ej: 8500)
  removals: string[];      // ingredientes removidos, ej: ["cebolla", "tomate"]
}
