-- ============================================================
-- Migration: Fix RLS for PostGIS system tables + harden
--            application table policies
-- ============================================================



-- ────────────────────────────────────────────────────────────
-- 2.  Harden application table RLS
--
--     Ensure every application table only allows authenticated
--     users, and grants no public/anon read access for writes.
-- ────────────────────────────────────────────────────────────

-- gps_records: authenticated read + firmware service-role write
ALTER TABLE public.gps_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gps_records_select_auth" ON public.gps_records;
CREATE POLICY "gps_records_select_auth"
  ON public.gps_records
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "gps_records_insert_service" ON public.gps_records;
CREATE POLICY "gps_records_insert_service"
  ON public.gps_records
  FOR INSERT
  TO service_role
  WITH CHECK (true);


-- device_status: authenticated read + service-role upsert
ALTER TABLE public.device_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_status_select_auth" ON public.device_status;
CREATE POLICY "device_status_select_auth"
  ON public.device_status
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "device_status_upsert_service" ON public.device_status;
CREATE POLICY "device_status_upsert_service"
  ON public.device_status
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- system_events: authenticated read + service-role insert
ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_events_select_auth" ON public.system_events;
CREATE POLICY "system_events_select_auth"
  ON public.system_events
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "system_events_insert_service" ON public.system_events;
CREATE POLICY "system_events_insert_service"
  ON public.system_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);
