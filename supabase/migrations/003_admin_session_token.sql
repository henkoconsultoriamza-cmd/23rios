-- Migración 003: Columna session_token en admin_credentials
-- Ejecutar en Supabase SQL Editor

ALTER TABLE admin_credentials
  ADD COLUMN IF NOT EXISTS session_token text;

-- Índice para lookup rápido en cada request autenticado
CREATE INDEX IF NOT EXISTS idx_admin_credentials_session_token
  ON admin_credentials (session_token)
  WHERE session_token IS NOT NULL;
