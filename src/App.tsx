import { useState } from 'react'
import Tracker from './components/Tracker'
import ExportTab from './components/ExportTab'

export default function App() {
  const [tab, setTab] = useState<'track' | 'export'>('track')

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Meeting Attendance Tracker</h1>
        <nav className="nav-tabs" aria-label="Tracker tabs">
          <button type="button" className={tab === 'track' ? 'active' : ''} onClick={() => setTab('track')}>
            Track
          </button>
          <button type="button" className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}>
            Export
          </button>
        </nav>
      </header>

      <main>{tab === 'track' ? <Tracker /> : <ExportTab />}</main>

      <footer className="footer-note">
        Personal tracker — no permissions required. Install as an app from your browser.
      </footer>
    </div>
  )
}
