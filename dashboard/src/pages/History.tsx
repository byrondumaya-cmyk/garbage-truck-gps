import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet'
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

const startIcon = L.divIcon({
  html: `<div style="background:#22c55e;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)">🚀</div>`,
  className: '', iconSize: [28, 28], iconAnchor: [14, 14],
})
const endIcon = L.divIcon({
  html: `<div style="background:#ef4444;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)">🏁</div>`,
  className: '', iconSize: [28, 28], iconAnchor: [14, 14],
})

interface GpsRecord {
  id: number
  lat: number
  lon: number
  speed_kmh: number
  battery_pct: number
  timestamp: string
}

export default function History() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [route, setRoute] = useState<GpsRecord[]>([])
  const [loading, setLoading] = useState(false)
  const defaultCenter: [number, number] = [15.4912, 120.8321]

  useEffect(() => {
    const fetchRoute = async () => {
      setLoading(true)
      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)

      const { data } = await supabase
        .from('gps_records')
        .select('id, lat, lon, speed_kmh, battery_pct, timestamp')
        .gte('timestamp', startOfDay.toISOString())
        .lte('timestamp', endOfDay.toISOString())
        .order('timestamp', { ascending: true })

      if (data) setRoute(data as GpsRecord[])
      setLoading(false)
    }
    fetchRoute()
  }, [date])

  const positions: [number, number][] = route.map(r => [r.lat, r.lon])
  const totalDistance = route.length > 1
    ? route.reduce((acc, r, i) => {
        if (i === 0) return 0
        const prev = route[i - 1]
        const R = 6371
        const dLat = (r.lat - prev.lat) * Math.PI / 180
        const dLon = (r.lon - prev.lon) * Math.PI / 180
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.lat * Math.PI / 180) * Math.cos(r.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
        return acc + R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      }, 0)
    : 0
  const avgSpeed = route.length > 0 ? route.reduce((s, r) => s + (r.speed_kmh || 0), 0) / route.length : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a' }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px', background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 style={{ color: '#fff', fontSize: '20px', fontWeight: 700, margin: 0 }}>📜 Route History</h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', margin: '2px 0 0' }}>
              {route.length} data points recorded
            </p>
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{
              padding: '8px 14px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '10px', color: '#fff', fontSize: '13px',
              outline: 'none', cursor: 'pointer',
            }}
          />
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {[
            { icon: '📍', label: 'Data Points', value: route.length.toString(), color: '#38bdf8' },
            { icon: '📏', label: 'Distance', value: `${totalDistance.toFixed(2)} km`, color: '#22c55e' },
            { icon: '⚡', label: 'Avg Speed', value: `${avgSpeed.toFixed(1)} km/h`, color: '#a78bfa' },
          ].map(({ icon, label, value, color }) => (
            <div key={label} style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '12px', padding: '12px 16px',
            }}>
              <div style={{ fontSize: '16px' }}>{icon}</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
              <div style={{ color, fontSize: '18px', fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Map or Loader */}
      <div style={{ flex: 1, position: 'relative' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.4)', gap: '12px' }}>
            <div style={{ fontSize: '32px' }}>⏳</div>
            <div>Loading route data...</div>
          </div>
        ) : (
          <MapContainer
            center={positions.length > 0 ? positions[0] : defaultCenter}
            zoom={14}
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            />
            {positions.length > 0 && (
              <>
                <Polyline
                  positions={positions}
                  pathOptions={{ color: '#22c55e', weight: 4, opacity: 0.9, dashArray: undefined }}
                />
                <Marker position={positions[0]} icon={startIcon}>
                  <Popup>🚀 Start of Route<br />{new Date(route[0].timestamp).toLocaleTimeString()}</Popup>
                </Marker>
                <Marker position={positions[positions.length - 1]} icon={endIcon}>
                  <Popup>🏁 End of Route<br />{new Date(route[route.length - 1].timestamp).toLocaleTimeString()}</Popup>
                </Marker>
              </>
            )}
            {positions.length === 0 && (
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 999, background: 'rgba(15,23,42,0.9)', padding: '16px 24px', borderRadius: '12px', color: 'white' }}>
                No data for this date
              </div>
            )}
          </MapContainer>
        )}
      </div>
    </div>
  )
}
