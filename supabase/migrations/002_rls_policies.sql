-- Migración 002: RLS Policies
-- Ejecutar en Supabase SQL Editor

-- ─── restaurant_config ───────────────────────────────────────────────────────
-- Cualquiera puede leer (menú público), solo service_role puede escribir

CREATE POLICY "config_public_read"
  ON restaurant_config FOR SELECT
  USING (true);

CREATE POLICY "config_service_write"
  ON restaurant_config FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "config_service_update"
  ON restaurant_config FOR UPDATE
  USING (auth.role() = 'service_role');

-- ─── admin_credentials ───────────────────────────────────────────────────────
-- Solo service_role puede leer y escribir. Nunca desde el cliente.

CREATE POLICY "admin_creds_service_only_read"
  ON admin_credentials FOR SELECT
  USING (auth.role() = 'service_role');

CREATE POLICY "admin_creds_service_only_write"
  ON admin_credentials FOR ALL
  USING (auth.role() = 'service_role');

-- ─── analytics_events ────────────────────────────────────────────────────────
-- Cualquiera puede insertar, solo service_role puede leer

CREATE POLICY "analytics_public_insert"
  ON analytics_events FOR INSERT
  WITH CHECK (true);

CREATE POLICY "analytics_service_read"
  ON analytics_events FOR SELECT
  USING (auth.role() = 'service_role');

-- ─── table_sessions, orders, order_lines, order_outbox ───────────────────────
-- Solo service_role. El cliente nunca accede directo — todo pasa por /api/orders

CREATE POLICY "sessions_service_only"
  ON table_sessions FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "orders_service_only"
  ON orders FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "order_lines_service_only"
  ON order_lines FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "order_outbox_service_only"
  ON order_outbox FOR ALL
  USING (auth.role() = 'service_role');
