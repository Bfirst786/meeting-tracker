import { useState } from 'react'
import Tracker from './components/Tracker'
import ExportTab from './components/ExportTab'
import FindTab from './components/FindTab'

type Tab = 'track' | 'find' | 'export'

const TABS: { id: Tab; label: string }[] = [
  { id: 'track', label: 'Track' },
  { id: 'find', label: 'Find' },
  { id: 'export', label: 'Export' }
]

export default function App() {
  const [tab, setTab] = useState<Tab>('track')

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Meeting Attendance Tracker</h1>
        <nav className="nav-tabs" aria-label="Tracker tabs">
          {TABS.map(({ id, label }) => (
            <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {tab === 'track' && <Tracker />}
        {tab === 'find' && <FindTab onViewTrack={() => setTab('track')} />}
        {tab === 'export' && <ExportTab />}
      </main>

      <footer className="footer-note">
        Personal tracker — your entries stay on this device. Install as an app from your browser.
      </footer>
    </div>
  )
}
