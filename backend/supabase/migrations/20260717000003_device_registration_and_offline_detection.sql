-- ================================================================
-- Migration: Register TRUCK-001 device + add pg_cron offline detection
-- ================================================================

-- ── 1. Register the TRUCK-001 device ──────────────────────────
-- This inserts the truck into the devices table with a secure,
-- pre-shared API key. The same API_KEY value must be flashed
-- into the firmware's #define DEVICE_API_KEY.
--
-- IMPORTANT: Replace the api_key below with your own random
-- string before running. Generate one at: https://randomkeygen.com
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.devices (device_id, name, api_key, is_active)
VALUES (
  'TRUCK-001',
  'Garbage Truck 1 - Aliaga',
  'gtrk-aliaga-2026-change-this-before-deploy',
  true
)
ON CONFLICT (device_id) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active;
-- NOTE: api_key is intentionally NOT updated on conflict to
-- avoid accidentally overwriting a correctly-set production key.


-- ── 2. Enable pg_cron for offline detection ───────────────────
-- pg_cron is available on Supabase Pro plans.
-- On the free tier, skip this block and handle it from the
-- dashboard's Supabase client (see LiveMap.tsx staleness check).
-- ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Function: mark devices as offline if no update for 3+ minutes
CREATE OR REPLACE FUNCTION public.mark_stale_devices_offline()
RETURNS void AS $$
BEGIN
  UPDATE public.device_status
  SET status = 'offline'
  WHERE
    status = 'online'
    AND last_seen < NOW() - INTERVAL '3 minutes';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule: run every 60 seconds
SELECT cron.schedule(
  'mark-stale-devices-offline',   -- job name (unique)
  '* * * * *',                    -- every 1 minute
  'SELECT public.mark_stale_devices_offline()'
);
