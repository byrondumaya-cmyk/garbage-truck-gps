import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import L from 'leaflet'

// Fix Leaflet's default icon path issues in React
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
})
L.Marker.prototype.options.icon = DefaultIcon

interface DeviceStatus {
  device_id: string
  last_seen: string
  last_lat: number
  last_lon: number
  last_speed: number
  battery_pct: number
  rssi_dbm: number
  status: string
}

export default function LiveMap() {
  const [device, setDevice] = useState<DeviceStatus | null>(null)
  
  // Center of Aliaga, Nueva Ecija
  const defaultCenter = { lat: 15.4912, lng: 120.8321 }

  useEffect(() => {
    // Initial fetch
    const fetchDevice = async () => {
      const { data } = await supabase
        .from('device_status')
        .select('*')
        .limit(1)
        .single()
      
      if (data) setDevice(data)
    }

    fetchDevice()

    // Subscribe to real-time updates
    const channel = supabase
      .channel('device_status_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'device_status' },
        (payload) => {
          setDevice(payload.new as DeviceStatus)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 bg-white border-b">
        <h2 className="text-2xl font-bold text-gray-800">Live Map</h2>
        {device && (
          <div className="mt-4 grid grid-cols-4 gap-4">
            <div className="bg-gray-50 p-4 rounded-lg border">
              <div className="text-sm text-gray-500">Status</div>
              <div className="text-lg font-bold text-green-600 uppercase">{device.status}</div>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg border">
              <div className="text-sm text-gray-500">Battery</div>
              <div className="text-lg font-bold">{device.battery_pct}%</div>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg border">
              <div className="text-sm text-gray-500">Speed</div>
              <div className="text-lg font-bold">{device.last_speed?.toFixed(1) || 0} km/h</div>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg border">
              <div className="text-sm text-gray-500">Last Seen</div>
              <div className="text-lg font-bold">{new Date(device.last_seen).toLocaleTimeString()}</div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 relative">
        <MapContainer 
          center={device ? [device.last_lat, device.last_lon] : [defaultCenter.lat, defaultCenter.lng]} 
          zoom={14} 
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {device && device.last_lat && device.last_lon && (
            <Marker position={[device.last_lat, device.last_lon]}>
              <Popup>
                <div className="font-medium">Garbage Truck</div>
                <div className="text-sm text-gray-600">Speed: {device.last_speed} km/h</div>
                <div className="text-sm text-gray-600">Battery: {device.battery_pct}%</div>
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  )
}
