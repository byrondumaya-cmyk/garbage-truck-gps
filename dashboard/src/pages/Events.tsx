import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface SystemEvent {
  id: string
  event_type: string
  payload: Record<string, unknown>
  timestamp: string
}

const eventColors: Record<string, { bg: string; text: string; icon: string }> = {
  boot: { bg: 'rgba(56,189,248,0.15)', text: '#38bdf8', icon: '🔄' },
  gps_fix: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e', icon: '📍' },
  lte_connected: { bg: 'rgba(167,139,250,0.15)', text: '#a78bfa', icon: '📡' },
  lte_disconnected: { bg: 'rgba(239,68,68,0.15)', text: '#f87171', icon: '❌' },
  battery_low: { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24', icon: '🪫' },
  upload_fail: { bg: 'rgba(239,68,68,0.15)', text: '#f87171', icon: '⚠️' },
  upload_success: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e', icon: '✅' },
}

function getEventStyle(type: string) {
  return eventColors[type] ?? { bg: 'rgba(255,255,255,0.05)', text: '#94a3b8', icon: '📋' }
}

function timeSince(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(dateStr).toLocaleDateString()
}

export default function Events() {
  const [events, setEvents] = useState<SystemEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    const fetchEvents = async () => {
      const { data } = await supabase
        .from('system_events')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100)

      if (data) setEvents(data as SystemEvent[])
      setLoading(false)
    }
    fetchEvents()

    const channel = supabase
      .channel('system_events_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_events' }, (payload) => {
        setEvents(prev => [payload.new as SystemEvent, ...prev].slice(0, 100))
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const eventTypes = ['all', ...Array.from(new Set(events.map(e => e.event_type)))]
  const filtered = filter === 'all' ? events : events.filter(e => e.event_type === filter)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      {/* Header */}
      <div style={{
        padding: '20px 24px', background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <h2 style={{ color: '#fff', fontSize: '20px', fontWeight: 700, margin: 0 }}>📋 System Events</h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', margin: '2px 0 0' }}>
              Real-time device event log
            </p>
          </div>
          <div style={{
            background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: '100px', padding: '4px 12px', color: '#22c55e', fontSize: '12px', fontWeight: 600,
          }}>
            🔴 LIVE
          </div>
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {eventTypes.map(type => {
            const style = getEventStyle(type)
            const active = filter === type
            return (
              <button
                key={type}
                onClick={() => setFilter(type)}
                style={{
                  padding: '5px 12px', borderRadius: '100px', fontSize: '11px', fontWeight: 600,
                  border: `1px solid ${active ? style.text : 'rgba(255,255,255,0.1)'}`,
                  background: active ? style.bg : 'transparent',
                  color: active ? style.text : 'rgba(255,255,255,0.4)',
                  cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em',
                  transition: 'all 0.15s',
                }}
              >
                {type === 'all' ? '🔍 All' : `${style.icon} ${type}`}
              </button>
            )
          })}
        </div>
      </div>

      {/* Event List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'rgba(255,255,255,0.4)', marginTop: '40px', justifyContent: 'center' }}>
            <div>⏳ Loading events...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', marginTop: '60px' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
            <div>No events recorded yet</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>Events will appear here when the truck connects</div>
          </div>
        ) : (
          filtered.map((event) => {
            const style = getEventStyle(event.event_type)
            return (
              <div
                key={event.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '12px',
                  background: style.bg,
                  border: `1px solid ${style.text}30`,
                  borderRadius: '12px', padding: '14px 16px',
                  transition: 'transform 0.15s',
                }}
              >
                <span style={{ fontSize: '20px', flexShrink: 0 }}>{style.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      color: style.text, fontSize: '12px', fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                    }}>
                      {event.event_type}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', flexShrink: 0 }}>
                      {timeSince(event.timestamp)}
                    </span>
                  </div>
                  {event.payload && Object.keys(event.payload).length > 0 && (
                    <div style={{
                      marginTop: '6px', color: 'rgba(255,255,255,0.5)', fontSize: '12px',
                      fontFamily: 'monospace', wordBreak: 'break-all',
                      background: 'rgba(0,0,0,0.2)', borderRadius: '6px', padding: '6px 10px',
                    }}>
                      {JSON.stringify(event.payload)}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
