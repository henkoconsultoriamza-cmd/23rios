-- Migracion 001: Integracion Fudo x Menu Digital 23 Rios


-- Limpieza de tablas incompletas de ejecuciones anteriores
-- (seguro: estas tablas no tienen datos reales todavia)

DROP TABLE IF EXISTS order_outbox   CASCADE;
DROP TABLE IF EXISTS order_lines    CASCADE;
DROP TABLE IF EXISTS orders         CASCADE;
DROP TABLE IF EXISTS table_sessions CASCADE;
DROP TABLE IF EXISTS fudo_tables    CASCADE;

DROP TYPE IF EXISTS outbox_status;
DROP TYPE IF EXISTS line_status;
DROP TYPE IF EXISTS order_status;
DROP TYPE IF EXISTS session_state;


-- TIPOS ENUM

CREATE TYPE session_state AS ENUM (
  'READY', 'OPENING', 'OPEN_UNKNOWN', 'OPEN', 'CHECKOUT', 'CLOSED'
);

CREATE TYPE order_status AS ENUM (
  'RECEIVED', 'PROCESSING', 'REGISTERED', 'REQUIRES_REVIEW'
);

CREATE TYPE line_status AS ENUM (
  'PENDING', 'SENDING', 'ACKNOWLEDGED', 'VERIFIED', 'REJECTED', 'UNKNOWN'
);

CREATE TYPE outbox_status AS ENUM (
  'PENDING', 'PROCESSING', 'DONE', 'FAILED'
);


-- fudo_tables: mapeo de mesas del local

CREATE TABLE fudo_tables (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    text NOT NULL DEFAULT 'local-a',
  mesa_numero      text NOT NULL,
  fudo_table_id    text NOT NULL,
  qr_token         text NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fudo_tables_token_length CHECK (char_length(qr_token) >= 16),
  CONSTRAINT fudo_tables_unique_mesa  UNIQUE (restaurant_id, mesa_numero),
  CONSTRAINT fudo_tables_unique_token UNIQUE (qr_token)
);

COMMENT ON TABLE  fudo_tables               IS 'Mapeo mesa visible - ID Fudo - token QR';
COMMENT ON COLUMN fudo_tables.mesa_numero   IS 'Numero o nombre que ve el cliente (ej: 10)';
COMMENT ON COLUMN fudo_tables.fudo_table_id IS 'ID interno de Fudo para esa mesa fisica';
COMMENT ON COLUMN fudo_tables.qr_token      IS 'Token del QR. Modo A: uno para todo el local. Modo B: uno por mesa';


-- table_sessions: visita activa por mesa

CREATE TABLE table_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    text NOT NULL DEFAULT 'local-a',
  fudo_table_id    text NOT NULL,
  fudo_sale_id     text,
  people           integer NOT NULL CHECK (people BETWEEN 1 AND 100),
  session_state    session_state NOT NULL DEFAULT 'READY',
  opening_body     jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz
);

CREATE UNIQUE INDEX table_sessions_one_active
  ON table_sessions (restaurant_id, fudo_table_id)
  WHERE session_state <> 'CLOSED';

COMMENT ON TABLE  table_sessions              IS 'Visita activa por mesa. Una sola por mesa mientras no este CLOSED';
COMMENT ON COLUMN table_sessions.fudo_sale_id IS 'Se llena cuando el worker crea la Sale en Fudo. NULL = sin cuenta abierta aun';
COMMENT ON COLUMN table_sessions.opening_body IS 'Cuerpo persistido antes del POST /sales. Permite recuperar si el worker cae';


-- orders: cada tanda de pedido

CREATE TABLE orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     text NOT NULL DEFAULT 'local-a',
  table_session_id  uuid NOT NULL REFERENCES table_sessions(id),
  idempotency_key   uuid NOT NULL,
  catalog_revision  text NOT NULL,
  body_hash         text NOT NULL,
  status            order_status NOT NULL DEFAULT 'RECEIVED',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_unique_idempotency UNIQUE (restaurant_id, idempotency_key)
);

COMMENT ON TABLE  orders                  IS 'Cada tanda (carrito confirmado) de cualquier dispositivo en la mesa';
COMMENT ON COLUMN orders.idempotency_key  IS 'UUID del cliente. Mismo key + mismo body = devolver resultado existente';
COMMENT ON COLUMN orders.catalog_revision IS 'Si cambio entre que el cliente vio el precio y confirmo, se responde 409';
COMMENT ON COLUMN orders.body_hash        IS 'Huella del pedido. Misma key + distinto hash = 409 IDEMPOTENCY_CONFLICT';


-- order_lines: cada item dentro de una tanda

CREATE TABLE order_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id),
  line_id          uuid NOT NULL,
  product_id       text NOT NULL,
  fudo_product_id  text NOT NULL,
  serving          text,
  quantity         integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor > 0),
  comment          text CHECK (char_length(comment) <= 255),
  fudo_item_body   jsonb,
  fudo_item_id     text,
  fudo_item_uuid   uuid NOT NULL DEFAULT gen_random_uuid(),
  status           line_status NOT NULL DEFAULT 'PENDING',
  attempts         integer NOT NULL DEFAULT 0,
  error_detail     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_lines_unique_line UNIQUE (order_id, line_id)
);

COMMENT ON TABLE  order_lines                IS 'Un item por fila. Se envian a Fudo de a uno, en orden';
COMMENT ON COLUMN order_lines.fudo_item_body IS 'Persistido antes del POST /items. Permite recuperar si el worker cae';
COMMENT ON COLUMN order_lines.fudo_item_id   IS 'Una vez llenado, nunca se hace otro POST para esta linea';
COMMENT ON COLUMN order_lines.comment        IS 'Ej: removals ["cebolla"] -> "Sin cebolla"';


-- order_outbox: cola del worker

CREATE TABLE order_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders(id),
  status        outbox_status NOT NULL DEFAULT 'PENDING',
  leased_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_outbox_one_per_order UNIQUE (order_id)
);

COMMENT ON TABLE  order_outbox              IS 'Cola del worker. Se inserta al crear order; Edge Function procesa';
COMMENT ON COLUMN order_outbox.leased_until IS 'Exclusion por mesa: otro worker no toca esta fila hasta que venza el lease';


-- Indices

CREATE INDEX idx_table_sessions_active
  ON table_sessions (restaurant_id, fudo_table_id, session_state)
  WHERE session_state <> 'CLOSED';

CREATE INDEX idx_order_lines_pending
  ON order_lines (order_id, status)
  WHERE status IN ('PENDING', 'SENDING', 'ACKNOWLEDGED');

CREATE INDEX idx_order_outbox_pending
  ON order_outbox (status, leased_until)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE INDEX idx_orders_session
  ON orders (table_session_id, created_at DESC);


-- Funcion updated_at automatico

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_table_sessions_updated_at
  BEFORE UPDATE ON table_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_order_lines_updated_at
  BEFORE UPDATE ON order_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_order_outbox_updated_at
  BEFORE UPDATE ON order_outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Row Level Security: solo service_role puede operar estas tablas

ALTER TABLE fudo_tables      ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_lines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_outbox     ENABLE ROW LEVEL SECURITY;
