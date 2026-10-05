-- ============================================================
-- Migración: columnas y tabla para integración Fudo
-- Ejecutar en el SQL Editor de Supabase (una sola vez)
-- ============================================================

-- 1. fudo_sale_id en table_sessions
--    El ID de la cuenta abierta en Fudo para esta visita de mesa
ALTER TABLE table_sessions
  ADD COLUMN IF NOT EXISTS fudo_sale_id TEXT;

-- 2. fudo_item_id en order_lines
--    El ID que Fudo asigna al ítem confirmado
ALTER TABLE order_lines
  ADD COLUMN IF NOT EXISTS fudo_item_id TEXT;

-- 3. Columna status mejorada en order_lines
--    Nuevo estado SKIPPED para ítems sin mapeo Fudo
--    (si la columna ya existe como TEXT libre, no hay que hacer nada)

-- 4. error_message en order_outbox
--    Guarda el error cuando status = 'ERROR'
ALTER TABLE order_outbox
  ADD COLUMN IF NOT EXISTS error_message TEXT;

-- 5. Tabla fudo_tables — mapa mesa_numero → fudo_table_id
--    Sincronizada desde GET /api/fudo-worker (llama a GET /tables en Fudo)
CREATE TABLE IF NOT EXISTS fudo_tables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mesa_numero     TEXT NOT NULL UNIQUE,  -- "1", "2", ... tal como el cliente lo ve
  fudo_table_id   TEXT NOT NULL,         -- ID interno de Fudo (puede ser distinto al número visible)
  fudo_table_name TEXT,
  active          BOOLEAN DEFAULT TRUE,
  synced_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsqueda rápida por número de mesa
CREATE INDEX IF NOT EXISTS idx_fudo_tables_mesa ON fudo_tables (mesa_numero);

-- ============================================================
-- Verificación rápida post-migración
-- ============================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'table_sessions' AND column_name = 'fudo_sale_id';
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'order_lines' AND column_name = 'fudo_item_id';
--
-- SELECT * FROM fudo_tables LIMIT 5;
