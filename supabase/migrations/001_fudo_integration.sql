-- Migración 001: Integración Fudo
-- Pegar en Supabase SQL Editor y ejecutar:
-- https://supabase.com/dashboard/project/_/sql

-- Borrar tablas previas si existen (en orden inverso por las FK)
DROP TABLE IF EXISTS order_outbox  CASCADE;
DROP TABLE IF EXISTS order_lines   CASCADE;
DROP TABLE IF EXISTS orders        CASCADE;
DROP TABLE IF EXISTS table_sessions CASCADE;

-- ─── table_sessions ──────────────────────────────────────────────────────────
CREATE TABLE table_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  mesa_numero      text        NOT NULL,
  fudo_table_id    text        NOT NULL,
  fudo_sale_id     text,
  people           integer     NOT NULL DEFAULT 1,
  session_state    text        NOT NULL DEFAULT 'READY'
                               CHECK (session_state IN ('READY','OPENING','OPEN','CHECKOUT','CLOSED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz
);

CREATE INDEX idx_table_sessions_active
  ON table_sessions (mesa_numero, session_state)
  WHERE session_state NOT IN ('CLOSED');

-- ─── orders ──────────────────────────────────────────────────────────────────
CREATE TABLE orders (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_session_id  uuid        NOT NULL REFERENCES table_sessions(id),
  idempotency_key   uuid        NOT NULL UNIQUE,
  catalog_revision  text,
  status            text        NOT NULL DEFAULT 'RECEIVED'
                                CHECK (status IN ('RECEIVED','PROCESSING','REGISTERED','REQUIRES_REVIEW','FAILED')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_session
  ON orders (table_session_id, created_at DESC);

-- ─── order_lines ─────────────────────────────────────────────────────────────
CREATE TABLE order_lines (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid        NOT NULL REFERENCES orders(id),
  line_id          uuid        NOT NULL,
  product_id       text        NOT NULL,
  fudo_product_id  text,
  quantity         integer     NOT NULL DEFAULT 1,
  unit_price       integer     NOT NULL,
  comment          text,
  fudo_item_id     text,
  status           text        NOT NULL DEFAULT 'PENDING'
                               CHECK (status IN ('PENDING','SENDING','ACKNOWLEDGED','VERIFIED','REJECTED','UNKNOWN')),
  attempts         integer     NOT NULL DEFAULT 0,
  error_detail     text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_lines_order
  ON order_lines (order_id);

-- ─── order_outbox ─────────────────────────────────────────────────────────────
CREATE TABLE order_outbox (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid        NOT NULL REFERENCES orders(id),
  status        text        NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','PROCESSING','DONE','FAILED')),
  leased_until  timestamptz,
  attempts      integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_outbox_pending
  ON order_outbox (status, leased_until)
  WHERE status = 'PENDING';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_outbox   ENABLE ROW LEVEL SECURITY;

-- ─── Trigger: dispara la Edge Function cuando entra un pedido al outbox ───────
CREATE OR REPLACE FUNCTION notify_process_fudo_order()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM net.http_post(
    url    := current_setting('app.supabase_functions_url') || '/process-fudo-order',
    body   := jsonb_build_object('record', row_to_json(NEW)),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_process_fudo_order
  AFTER INSERT ON order_outbox
  FOR EACH ROW EXECUTE FUNCTION notify_process_fudo_order();
