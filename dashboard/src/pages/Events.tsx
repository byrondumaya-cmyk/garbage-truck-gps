import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface SystemEvent {
  id: string
  event_type: string
  payload: any
  timestamp: string
}

export default function Events() {
  const [events, setEvents] = useState<SystemEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const { data, error } = await supabase
          .from('system_events')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(50)

        if (data) setEvents(data)
      } catch {}
      setLoading(false)
    }

    fetchEvents()

    const channel = supabase
      .channel('system_events_changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'system_events' },
        (payload) => {
          setEvents(prev => [payload.new as SystemEvent, ...prev].slice(0, 50))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">System Events</h2>
      
      <div className="bg-white rounded-lg shadow border overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Event Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={3} className="px-6 py-4 text-center">Loading...</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={3} className="px-6 py-4 text-center">No events found</td></tr>
            ) : (
              events.map((event) => (
                <tr key={event.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(event.timestamp).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {event.event_type}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 font-mono">
                    {JSON.stringify(event.payload)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
