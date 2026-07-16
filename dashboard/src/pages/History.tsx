import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'

export default function History() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [route, setRoute] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const defaultCenter = { lat: 15.4912, lng: 120.8321 }

  useEffect(() => {
    const fetchRoute = async () => {
      setLoading(true)
      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)

      const { data } = await supabase
        .from('gps_records')
        .select('*')
        .gte('timestamp', startOfDay.toISOString())
        .lte('timestamp', endOfDay.toISOString())
        .order('timestamp', { ascending: true })
      
      if (data) setRoute(data)
      setLoading(false)
    }

    fetchRoute()
  }, [date])

  const positions = route.map(r => [r.lat, r.lon] as [number, number])

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 bg-white border-b flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-800">Route History</h2>
        
        <div className="flex items-center space-x-4">
          <label className="text-sm font-medium text-gray-700">Select Date:</label>
          <input
            type="date"
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">Loading route data...</div>
      ) : (
        <div className="flex-1 relative">
          <MapContainer 
            center={positions.length > 0 ? positions[0] : [defaultCenter.lat, defaultCenter.lng]} 
            zoom={13} 
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {positions.length > 0 && (
              <Polyline 
                positions={positions} 
                pathOptions={{ color: 'blue', weight: 4 }} 
              />
            )}
            {positions.length > 0 && (
              <>
                <Marker position={positions[0]}>
                  <Popup>Start</Popup>
                </Marker>
                <Marker position={positions[positions.length - 1]}>
                  <Popup>End</Popup>
                </Marker>
              </>
            )}
          </MapContainer>
        </div>
      )}
    </div>
  )
}
