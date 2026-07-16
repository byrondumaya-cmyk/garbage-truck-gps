-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Devices Table
CREATE TABLE IF NOT EXISTS public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- GPS Records Table
CREATE TABLE IF NOT EXISTS public.gps_records (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID REFERENCES public.devices(id),
  timestamp TIMESTAMPTZ NOT NULL,
  location GEOGRAPHY(POINT, 4326),
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  speed_kmh REAL,
  heading_deg REAL,
  hdop REAL,
  satellites SMALLINT,
  battery_mv INTEGER,
  battery_pct SMALLINT,
  rssi_dbm SMALLINT,
  lte_connected BOOLEAN DEFAULT TRUE,
  gps_fix BOOLEAN DEFAULT TRUE,
  sequence_no BIGINT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gps_records_device_time ON public.gps_records(device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_gps_records_location ON public.gps_records USING GIST(location);

-- Device Status Table
CREATE TABLE IF NOT EXISTS public.device_status (
  device_id UUID PRIMARY KEY REFERENCES public.devices(id),
  last_seen TIMESTAMPTZ,
  last_lat DOUBLE PRECISION,
  last_lon DOUBLE PRECISION,
  last_speed REAL,
  battery_pct SMALLINT,
  rssi_dbm SMALLINT,
  lte_connected BOOLEAN,
  gps_fix BOOLEAN,
  fw_version TEXT,
  reboot_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'unknown'
);

-- System Events Table
CREATE TABLE IF NOT EXISTS public.system_events (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID REFERENCES public.devices(id),
  event_type TEXT NOT NULL,
  payload JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Setup RLS
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gps_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view data
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.devices;
CREATE POLICY "Allow authenticated read access" ON public.devices FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow authenticated read access" ON public.gps_records;
CREATE POLICY "Allow authenticated read access" ON public.gps_records FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow authenticated read access" ON public.device_status;
CREATE POLICY "Allow authenticated read access" ON public.device_status FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow authenticated read access" ON public.system_events;
CREATE POLICY "Allow authenticated read access" ON public.system_events FOR SELECT USING (auth.role() = 'authenticated');
