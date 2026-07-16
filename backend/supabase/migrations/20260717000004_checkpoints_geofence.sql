-- ================================================================
-- Migration: Route Checkpoints + PostGIS Geofence Auto-Detection
-- ================================================================

-- ── 1. Checkpoints table ──────────────────────────────────────
-- Each checkpoint is a named geographic point with a radius.
-- Supervisors manage this table through the dashboard admin UI.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checkpoints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                    -- e.g. "Brgy. Poblacion Entrance"
  lat         DOUBLE PRECISION NOT NULL,
  lon         DOUBLE PRECISION NOT NULL,
  radius_m    INTEGER NOT NULL DEFAULT 75,       -- geofence radius in meters
  route_order INTEGER,                          -- expected visit order (1, 2, 3...)
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- PostGIS spatial column for fast proximity queries
ALTER TABLE public.checkpoints
  ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_checkpoints_location ON public.checkpoints USING GIST(location);

-- RLS: authenticated users can read; service_role can write
ALTER TABLE public.checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checkpoints_read_auth"  ON public.checkpoints FOR SELECT TO authenticated USING (true);
CREATE POLICY "checkpoints_write_auth" ON public.checkpoints FOR ALL    TO authenticated USING (true) WITH CHECK (true);


-- ── 2. Checkpoint visits log ──────────────────────────────────
-- Automatically populated by the trigger below.
-- One row per (checkpoint × gps_record) detection event.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checkpoint_visits (
  id              BIGSERIAL PRIMARY KEY,
  checkpoint_id   UUID REFERENCES public.checkpoints(id) ON DELETE CASCADE,
  device_id       UUID REFERENCES public.devices(id),
  gps_record_id   BIGINT REFERENCES public.gps_records(id),
  visited_at      TIMESTAMPTZ NOT NULL,
  distance_m      DOUBLE PRECISION          -- exact distance at detection
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_visits_device_time
  ON public.checkpoint_visits(device_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoint_visits_checkpoint
  ON public.checkpoint_visits(checkpoint_id, visited_at DESC);

-- RLS
ALTER TABLE public.checkpoint_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checkpoint_visits_read_auth"
  ON public.checkpoint_visits FOR SELECT TO authenticated USING (true);
CREATE POLICY "checkpoint_visits_write_service"
  ON public.checkpoint_visits FOR INSERT TO service_role WITH CHECK (true);


-- ── 3. Geofence trigger function ──────────────────────────────
-- Fires after every GPS record insert.
-- For each active checkpoint, checks if the new GPS position
-- is within the checkpoint's radius using ST_DWithin().
-- Inserts a visit record if within range and not already
-- visited within the last 30 minutes (debounce).
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_checkpoint_proximity()
RETURNS TRIGGER AS $$
DECLARE
  gps_point   GEOGRAPHY;
  cp          RECORD;
  dist_m      DOUBLE PRECISION;
  recent_visit BIGINT;
BEGIN
  -- Build the GPS point from the new record
  gps_point := ST_SetSRID(
    ST_MakePoint(NEW.lon, NEW.lat),
    4326
  )::geography;

  -- Loop through all active checkpoints
  FOR cp IN
    SELECT id, name, location, radius_m
    FROM   public.checkpoints
    WHERE  is_active = TRUE
  LOOP
    dist_m := ST_Distance(gps_point, cp.location);

    IF dist_m <= cp.radius_m THEN
      -- Debounce: skip if same device visited this checkpoint
      -- in the last 30 minutes
      SELECT id INTO recent_visit
      FROM   public.checkpoint_visits
      WHERE  checkpoint_id = cp.id
        AND  device_id     = NEW.device_id
        AND  visited_at    > NOW() - INTERVAL '30 minutes'
      LIMIT 1;

      IF recent_visit IS NULL THEN
        INSERT INTO public.checkpoint_visits
          (checkpoint_id, device_id, gps_record_id, visited_at, distance_m)
        VALUES
          (cp.id, NEW.device_id, NEW.id, NEW.timestamp, dist_m);

        RAISE NOTICE '[GEOFENCE] Device % visited checkpoint "%" (dist: %.1fm)',
          NEW.device_id, cp.name, dist_m;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to gps_records
DROP TRIGGER IF EXISTS tr_check_checkpoints ON public.gps_records;
CREATE TRIGGER tr_check_checkpoints
AFTER INSERT ON public.gps_records
FOR EACH ROW
EXECUTE FUNCTION public.check_checkpoint_proximity();


-- ── 4. Helper view: daily checkpoint compliance ───────────────
-- Useful for the History page: for each day, which checkpoints
-- were visited vs. which were expected?
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.daily_checkpoint_compliance AS
SELECT
  cv.device_id,
  DATE(cv.visited_at AT TIME ZONE 'Asia/Manila') AS date_ph,
  cp.id                                          AS checkpoint_id,
  cp.name                                        AS checkpoint_name,
  cp.route_order,
  MIN(cv.visited_at)                             AS first_visit,
  MIN(cv.distance_m)                             AS closest_m,
  COUNT(*)                                       AS visit_count
FROM   public.checkpoint_visits cv
JOIN   public.checkpoints cp ON cp.id = cv.checkpoint_id
GROUP  BY cv.device_id, date_ph, cp.id, cp.name, cp.route_order
ORDER  BY date_ph DESC, cp.route_order ASC;

COMMENT ON VIEW public.daily_checkpoint_compliance IS
  'Daily summary of which checkpoints each device visited, with first-visit time and closest approach distance.';
