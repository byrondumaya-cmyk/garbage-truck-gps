-- Function to update device_status on new gps_record
CREATE OR REPLACE FUNCTION public.update_device_status_on_gps()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.device_status (
    device_id,
    last_seen,
    last_lat,
    last_lon,
    last_speed,
    battery_pct,
    rssi_dbm,
    lte_connected,
    gps_fix,
    status
  )
  VALUES (
    NEW.device_id,
    NEW.timestamp,
    NEW.lat,
    NEW.lon,
    NEW.speed_kmh,
    NEW.battery_pct,
    NEW.rssi_dbm,
    NEW.lte_connected,
    NEW.gps_fix,
    'online'
  )
  ON CONFLICT (device_id) DO UPDATE SET
    last_seen = EXCLUDED.last_seen,
    last_lat = EXCLUDED.last_lat,
    last_lon = EXCLUDED.last_lon,
    last_speed = EXCLUDED.last_speed,
    battery_pct = EXCLUDED.battery_pct,
    rssi_dbm = EXCLUDED.rssi_dbm,
    lte_connected = EXCLUDED.lte_connected,
    gps_fix = EXCLUDED.gps_fix,
    status = 'online';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to fire after insert on gps_records
CREATE TRIGGER tr_update_device_status
AFTER INSERT ON public.gps_records
FOR EACH ROW
EXECUTE FUNCTION public.update_device_status_on_gps();
