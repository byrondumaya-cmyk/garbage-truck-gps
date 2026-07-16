import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import L from 'leaflet'

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Truck icon
const truckIcon = L.divIcon({
  html: `<div style="
    width:40px;height:40px;border-radius:50%;
    background:linear-gradient(135deg,#22c55e,#16a34a);
    display:flex;align-items:center;justify-content:center;
    font-size:20px;box-shadow:0 4px 15px rgba(34,197,94,0.6);
    border:3px solid white;
  ">🚛</div>`,
  className: '',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
})

interface DeviceStatus {
  device_id: string
  last_seen: string
  last_lat: number
  last_lon: number
  last_speed: number
  battery_pct: number
  rssi_dbm: number
  lte_connected: boolean
  gps_fix: boolean
  status: string
}

// Helper to fly map to new location on update
function MapController({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap()
  useEffect(() => {
    if (lat && lon) {
      map.flyTo([lat, lon], map.getZoom(), { animate: true, duration: 1.5 })
    }
  }, [lat, lon, map])
  return null
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '12px', padding: '16px',
      display: 'flex', flexDirection: 'column', gap: '4px',
    }}>
      <div style={{ fontSize: '18px' }}>{icon}</div>
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ color, fontSize: '20px', fontWeight: 700 }}>{value}</div>
    </div>
  )
}

export default function LiveMap() {
  const [device, setDevice] = useState<DeviceStatus | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const mapRef = useRef(null)
  const defaultCenter: [number, number] = [15.4912, 120.8321]

  useEffect(() => {
    const fetchDevice = async () => {
      const { data } = await supabase
        .from('device_status')
        .select('*')
        .limit(1)
        .single()
      if (data) {
        setDevice(data as DeviceStatus)
        setLastUpdate(new Date())
      }
    }
    fetchDevice()

    const channel = supabase
      .channel('device_status_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_status' }, (payload) => {
        setDevice(payload.new as DeviceStatus)
        setLastUpdate(new Date())
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const isOnline = device?.status === 'online'
  const batteryColor = !device ? '#6b7280' : device.battery_pct > 60 ? '#22c55e' : device.battery_pct > 30 ? '#f59e0b' : '#ef4444'
  const signalBars = !device?.rssi_dbm ? 0 : device.rssi_dbm > -70 ? 4 : device.rssi_dbm > -85 ? 3 : device.rssi_dbm > -100 ? 2 : 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a' }}>
      {/* Header Panel */}
      <div style={{
        padding: '20px 24px',
        background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: device ? '16px' : '0' }}>
          <div>
            <h2 style={{ color: '#fff', fontSize: '20px', fontWeight: 700, margin: 0 }}>🗺️ Live Tracking</h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', margin: '2px 0 0' }}>
              {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : 'Waiting for data...'}
            </p>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: isOnline ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.15)',
            border: `1px solid ${isOnline ? 'rgba(34,197,94,0.4)' : 'rgba(107,114,128,0.3)'}`,
            borderRadius: '100px', padding: '6px 14px',
          }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: isOnline ? '#22c55e' : '#6b7280',
              boxShadow: isOnline ? '0 0 8px #22c55e' : 'none',
            }} />
            <span style={{ color: isOnline ? '#22c55e' : '#9ca3af', fontSize: '12px', fontWeight: 600 }}>
              {isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>

        {device && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            <StatCard icon="⚡" label="Battery" value={`${device.battery_pct ?? '--'}%`} color={batteryColor} />
            <StatCard icon="🚀" label="Speed" value={`${device.last_speed?.toFixed(1) ?? '0'} km/h`} color="#38bdf8" />
            <StatCard icon="📡" label="Signal" value={`${signalBars}/4 bars`} color="#a78bfa" />
            <StatCard icon="📍" label="GPS Fix" value={device.gps_fix ? 'Active' : 'Searching'} color={device.gps_fix ? '#22c55e' : '#f59e0b'} />
          </div>
        )}

        {!device && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            color: 'rgba(255,255,255,0.4)', fontSize: '13px',
          }}>
            <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#22c55e', animation: 'spin 1s linear infinite' }} />
            Waiting for truck to connect...
          </div>
        )}
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer
          ref={mapRef}
          center={device?.last_lat ? [device.last_lat, device.last_lon] : defaultCenter}
          zoom={15}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />
          {device?.last_lat && device?.last_lon && (
            <>
              <MapController lat={device.last_lat} lon={device.last_lon} />
              <Marker position={[device.last_lat, device.last_lon]} icon={truckIcon}>
                <Popup>
                  <div style={{ fontFamily: 'Inter, sans-serif', minWidth: '160px' }}>
                    <div style={{ fontWeight: 700, marginBottom: '6px' }}>🚛 Garbage Truck</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      <div>Speed: {device.last_speed?.toFixed(1)} km/h</div>
                      <div>Battery: {device.battery_pct}%</div>
                      <div>GPS: {device.gps_fix ? '✅ Fixed' : '🔄 Searching'}</div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            </>
          )}
        </MapContainer>
      </div>
    </div>
  )
}
