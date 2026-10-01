-- Migración 004: Soporte para líneas modificadoras (combos/promos con Grupos Modificadores en Fudo)
-- Ejecutar en Supabase SQL Editor

-- parent_line_id: si tiene valor, esta línea es un modificador de otra línea
ALTER TABLE order_lines
  ADD COLUMN IF NOT EXISTS parent_line_id text;

CREATE INDEX IF NOT EXISTS idx_order_lines_parent
  ON order_lines (parent_line_id)
  WHERE parent_line_id IS NOT NULL;
