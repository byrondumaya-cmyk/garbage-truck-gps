import { Outlet, Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const navigation = [
  { name: 'Live Map', href: '/', icon: '🗺️', desc: 'Real-time position' },
  { name: 'History', href: '/history', icon: '📜', desc: 'Route replay' },
  { name: 'Events', href: '/events', icon: '📋', desc: 'System log' },
]

export default function Layout() {
  const location = useLocation()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.reload()
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0f172a', fontFamily: "'Inter', sans-serif" }}>
      {/* Sidebar */}
      <div style={{
        width: '220px', flexShrink: 0,
        background: 'rgba(255,255,255,0.03)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Logo */}
        <div style={{
          padding: '24px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px', flexShrink: 0,
            }}>🗑️</div>
            <div>
              <div style={{ color: '#fff', fontSize: '13px', fontWeight: 700, lineHeight: 1.2 }}>GarbageTrack</div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '10px' }}>GPS v1.0</div>
            </div>
          </div>
        </div>

        {/* Nav Items */}
        <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {navigation.map((item) => {
            const isActive = location.pathname === item.href
            return (
              <Link
                key={item.name}
                to={item.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '10px 12px', borderRadius: '10px',
                  background: isActive ? 'rgba(34,197,94,0.15)' : 'transparent',
                  border: isActive ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent',
                  textDecoration: 'none',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: '18px' }}>{item.icon}</span>
                <div>
                  <div style={{ color: isActive ? '#22c55e' : 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 600 }}>
                    {item.name}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px' }}>{item.desc}</div>
                </div>
                {isActive && (
                  <div style={{
                    marginLeft: 'auto', width: '6px', height: '6px', borderRadius: '50%',
                    background: '#22c55e', boxShadow: '0 0 8px #22c55e',
                  }} />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div style={{ padding: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={handleLogout}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 12px', borderRadius: '10px', border: 'none',
              background: 'transparent', cursor: 'pointer',
              color: 'rgba(255,255,255,0.4)', fontSize: '13px',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.1)'
              ;(e.currentTarget as HTMLButtonElement).style.color = '#f87171'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.4)'
            }}
          >
            <span>🚪</span>
            <span>Logout</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  )
}
