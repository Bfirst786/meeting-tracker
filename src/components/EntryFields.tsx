import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { SavedMeeting } from '../types'
import { loadLocations, saveLocations } from '../utils/storage'

/* ---------- Star rating ---------- */

export function StarRating({ value, onChange, size = 'md' }: { value?: number; onChange?: (v?: number) => void; size?: 'sm' | 'md' }) {
  const readOnly = !onChange
  return (
    <div className={`stars stars-${size}`} role={readOnly ? 'img' : 'radiogroup'} aria-label={value ? `${value} of 5 stars` : 'Not rated'}>
      {[1, 2, 3, 4, 5].map((n) =>
        readOnly ? (
          <span key={n} className={value && n <= value ? 'star on' : 'star'} aria-hidden="true">
            ★
          </span>
        ) : (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            className={value && n <= value ? 'star on' : 'star'}
            // Tapping the current rating again clears it.
            onClick={() => onChange(value === n ? undefined : n)}
          >
            ★
          </button>
        )
      )}
    </div>
  )
}

/* ---------- Duration: 30 / 60 / Custom ---------- */

export function DurationPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const preset = value === '30' || value === '60'
  const [custom, setCustom] = useState(!preset && value !== '')

  useEffect(() => {
    if (value === '') setCustom(false)
    else if (value !== '30' && value !== '60') setCustom(true)
  }, [value])

  return (
    <div className="field-group">
      <span className="field-label" id="duration-label">
        Duration
      </span>
      <div className="segmented" role="group" aria-labelledby="duration-label">
        {['30', '60'].map((m) => (
          <button
            key={m}
            type="button"
            className={!custom && value === m ? 'type-button active' : 'type-button'}
            aria-pressed={!custom && value === m}
            onClick={() => {
              setCustom(false)
              onChange(value === m && !custom ? '' : m)
            }}
          >
            {m} min
          </button>
        ))}
        <button
          type="button"
          className={custom ? 'type-button active' : 'type-button'}
          aria-pressed={custom}
          onClick={() => {
            setCustom(true)
            if (preset) onChange('')
          }}
        >
          Custom
        </button>
      </div>
      {custom && (
        <input
          id="meeting-duration"
          type="number"
          inputMode="numeric"
          min="0"
          value={value}
          placeholder="Minutes"
          aria-label="Custom duration in minutes"
          autoFocus
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

/* ---------- Location pull-down with an editable, ordered list ---------- */

const EDIT = '__edit__'

export function LocationPicker({ value, onChange, id = 'meeting-location' }: { value: string; onChange: (v: string) => void; id?: string }) {
  const [list, setList] = useState<string[]>([])
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    void loadLocations().then(setList)
  }, [])

  const update = (next: string[]) => {
    setList(next)
    void saveLocations(next)
  }

  // An entry being edited may use a location that has since been removed from the list.
  const options = value && !list.includes(value) ? [value, ...list] : list

  return (
    <div className="field-group">
      <label htmlFor={id}>Location</label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          if (e.target.value === EDIT) setEditing(true)
          else onChange(e.target.value)
        }}
      >
        <option value="">No location</option>
        {options.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
        <option value={EDIT}>Edit list…</option>
      </select>
      {editing && <LocationEditor list={list} onChange={update} onClose={() => setEditing(false)} />}
    </div>
  )
}

function LocationEditor({ list, onChange, onClose }: { list: string[]; onChange: (l: string[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState('')

  const move = (i: number, delta: number) => {
    const j = i + delta
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  const add = () => {
    const v = draft.trim()
    if (!v || list.some((l) => l.toLowerCase() === v.toLowerCase())) return
    onChange([...list, v])
    setDraft('')
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="loc-editor-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="loc-editor-title">Edit locations</h3>
        <p className="muted small">The pull-down shows these in this order.</p>
        <ol className="loc-list">
          {list.map((l, i) => (
            <li key={l}>
              <span className="loc-name">{l}</span>
              <button type="button" className="icon-button" aria-label={`Move ${l} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Move ${l} down`}
                disabled={i === list.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button type="button" className="icon-button danger" aria-label={`Remove ${l}`} onClick={() => onChange(list.filter((x) => x !== l))}>
                ✕
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="muted">No saved locations yet.</li>}
        </ol>
        <div className="loc-add">
          <input
            type="text"
            value={draft}
            placeholder="Add a location"
            aria-label="New location"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          <button type="button" className="secondary-button" onClick={add} disabled={!draft.trim()}>
            Add
          </button>
        </div>
        <button type="button" className="primary-button modal-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}

/* ---------- Saved meeting details (shown on a Track entry) ---------- */

export function MeetingDetails({ m }: { m: SavedMeeting }) {
  const start = new Date(m.start)
  const end = m.minutes ? new Date(start.getTime() + m.minutes * 60_000) : undefined
  return (
    <details className="saved-meeting">
      <summary>Meeting details</summary>
      <div className="saved-meeting-body">
        <div className="meeting-when">
          {format(start, 'EEEE h:mm a')}
          {end ? ` – ${format(end, 'h:mm a')}` : ''}
          {m.groupTime ? <span className="muted"> ({m.groupTime} where the group meets)</span> : null}
        </div>
        {(m.location || m.address) && (
          <div className="meeting-where">
            {m.location && <strong>{m.location}</strong>}
            {m.address && m.address !== m.location ? <span>{m.address}</span> : null}
            {m.locationNotes ? <span className="muted">{m.locationNotes}</span> : null}
          </div>
        )}
        <div className="meeting-buttons">
          {m.mapsUrl && (
            <a className="primary-button link-button" href={m.mapsUrl} target="_blank" rel="noreferrer">
              Get Directions
            </a>
          )}
          {m.conferenceUrl && (
            <a className={`${m.mapsUrl ? 'secondary-button' : 'primary-button'} link-button`} href={m.conferenceUrl} target="_blank" rel="noreferrer">
              {/zoom\./i.test(m.conferenceUrl) ? 'Join Zoom' : 'Join online'}
            </a>
          )}
          {m.dialString && (
            <a className="secondary-button link-button" href={`tel:${m.dialString}`}>
              Dial in
            </a>
          )}
          {m.email && (
            <a className="secondary-button link-button" href={`mailto:${m.email}`}>
              Email
            </a>
          )}
          {m.website && (
            <a className="secondary-button link-button" href={m.website} target="_blank" rel="noreferrer">
              Website
            </a>
          )}
        </div>
        {(m.conferenceNotes || m.phone) && (
          <div className="conference-notes">
            {m.conferenceNotes && <div>{m.conferenceNotes}</div>}
            {m.phone && <div>Phone: {m.phone}</div>}
          </div>
        )}
        {m.notes && <p className="saved-meeting-notes">{m.notes}</p>}
        {m.tags.length > 0 && (
          <div className="tag-row">
            {m.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
        {m.sourceUrl && (
          <a className="source-link" href={m.sourceUrl} target="_blank" rel="noreferrer">
            View on {m.sourceName ?? 'source site'}
          </a>
        )}
      </div>
    </details>
  )
}
