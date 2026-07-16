-- ============================================================
-- Migration: Fix RLS for PostGIS system tables + harden
--            application table policies
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1.  spatial_ref_sys  (PostGIS system table)
--
--     Supabase lint flags this because the table is in the
--     `public` schema and exposed to PostgREST, but has no
--     RLS.  The recommended fix is to enable RLS and add a
--     SELECT-only policy for authenticated users, then deny
--     writes entirely (the table is managed by PostGIS only).
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY;

-- Allow authenticated dashboard users to read projection data
-- (required by PostGIS geometry functions used by the dashboard).
DROP POLICY IF EXISTS "spatial_ref_sys_select" ON public.spatial_ref_sys;
CREATE POLICY "spatial_ref_sys_select"
  ON public.spatial_ref_sys
  FOR SELECT
  TO authenticated
  USING (true);

-- Deny all write operations — this table is PostGIS-managed.
-- No INSERT / UPDATE / DELETE policy = denied by default when
-- RLS is enabled.


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
