import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { saveAs } from 'file-saver'
import {
  DEFAULT_PLACE,
  InPersonMeeting,
  InPersonResult,
  OnlineMeeting,
  Place,
  appleMapsUrl,
  calendarFile,
  findInPerson,
  findOnline,
  geocode,
  loadInPersonMeetings,
  typeLabel
} from '../utils/meetings'
import { EntryType } from '../types'

export interface LogDraft {
  type: EntryType
  dateTime: string
  location?: string
  durationMinutes?: number
}

type Mode = 'online' | 'in-person'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const RADII = [2, 5, 10, 15, 25]
const WINDOWS = [2, 4, 6, 12, 24]
const PAGE = 40

const readMode = (): Mode => {
  try {
    return localStorage.getItem('find-mode') === 'online' ? 'online' : 'in-person'
  } catch {
    return 'in-person'
  }
}

/** Start of the search: now, unless a day and/or time was chosen. */
const searchStart = (day: string, time: string) => {
  const now = new Date()
  const start = new Date(now)
  if (day !== '') {
    const ahead = (Number(day) - now.getDay() + 7) % 7
    start.setDate(now.getDate() + ahead)
  }
  if (time) {
    const [h, m] = time.split(':').map(Number)
    // "Today" means today, even if the chosen time has just passed
    // (iOS's time picker opens on the current minute).
    start.setHours(h, m, 0, 0)
  } else if (start.toDateString() !== now.toDateString()) {
    start.setHours(0, 0, 0, 0)
  } else {
    start.setTime(now.getTime())
  }
  return start
}

const blockLabel = (d: Date) => {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const dayLabel =
    d.toDateString() === today.toDateString()
      ? 'Today'
      : d.toDateString() === tomorrow.toDateString()
        ? 'Tomorrow'
        : format(d, 'EEEE')
  return `${dayLabel} · ${format(d, 'h:mm a')}`
}

function groupByStart<T extends { start: Date }>(items: T[]) {
  const groups: { label: string; items: T[] }[] = []
  for (const item of items) {
    const label = blockLabel(item.start)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

const relative = (d: Date) =>
  d.getTime() <= Date.now() ? 'started' : `in ${formatDistanceToNowStrict(d, { roundingMethod: 'floor' })}`

export default function FindTab({ onLog }: { onLog: (draft: LogDraft) => void }) {
  const [mode, setMode] = useState<Mode>(readMode)
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const [hours, setHours] = useState(6)
  const [place, setPlace] = useState('')
  const [radius, setRadius] = useState(10)
  const [text, setText] = useState('')
  const [language, setLanguage] = useState('English')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [origin, setOrigin] = useState<Place>(DEFAULT_PLACE)
  const [inPerson, setInPerson] = useState<InPersonResult[] | null>(null)
  const [online, setOnline] = useState<OnlineMeeting[] | null>(null)
  const [feed, setFeed] = useState<InPersonMeeting[]>([])
  const [shown, setShown] = useState(PAGE)

  const runSearch = useCallback(
    async (searchMode: Mode) => {
      setBusy(true)
      setError('')
      setNotice('')
      setShown(PAGE)
      const start = searchStart(day, time)
      const end = new Date(start.getTime() + hours * 3600_000)
      try {
        if (searchMode === 'in-person') {
          const load = await loadInPersonMeetings()
          setFeed(load.data)
          if (load.stale) setNotice(`Couldn't refresh meeting lists — showing saved data from ${format(load.fetchedAt, 'MMM d, h:mm a')}.`)
          else if (load.errors.length) setNotice(`Some lists didn't load: ${load.errors.join('; ')}`)
          if (load.data.length === 0) throw new Error('No meeting lists could be loaded. Check your connection and try again.')

          let where: Place = DEFAULT_PLACE
          if (place.trim()) {
            const found = await geocode(place, load.data)
            if (!found) throw new Error(`Couldn't find “${place}”. Try a city, ZIP code or street address.`)
            where = found
          }
          setOrigin(where)
          setInPerson(findInPerson(load.data, { origin: where, radius, start, end, pinAlano: !place.trim(), text }))
        } else {
          const results = await findOnline(start, hours)
          const q = text.trim().toLowerCase()
          setOnline(
            results.filter(
              (m) =>
                (language === 'Any' || m.languages.length === 0 || m.languages.includes(language)) &&
                (!q || `${m.name} ${m.notes ?? ''}`.toLowerCase().includes(q))
            )
          )
        }
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [day, time, hours, place, radius, text, language]
  )

  // Default search runs as soon as the tab opens, and whenever the mode changes.
  useEffect(() => {
    try {
      localStorage.setItem('find-mode', mode)
    } catch {
      /* private mode */
    }
    void runSearch(mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    void runSearch(mode)
  }

  const resetFilters = () => {
    setDay('')
    setTime('')
    setPlace('')
    setText('')
  }

  const languages = useMemo(() => ['English', 'Spanish', 'Any'], [])
  const results = mode === 'in-person' ? inPerson : online
  const groups = useMemo(() => groupByStart((results ?? []).slice(0, shown) as { start: Date }[]), [results, shown])
  const venueCount = useMemo(() => new Set(feed.map((m) => m.location)).size, [feed])

  return (
    <section className="card panel">
      <div className="mode-toggle" role="tablist" aria-label="Meeting type">
        {(['in-person', 'online'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? 'type-button active' : 'type-button'}
            onClick={() => setMode(m)}
          >
            {m === 'online' ? 'Online' : 'In-Person'}
          </button>
        ))}
      </div>

      <form className="find-form" onSubmit={handleSubmit}>
        {mode === 'in-person' && (
          <>
            <div className="field-group find-wide">
              <label htmlFor="find-place">Near</label>
              <input
                id="find-place"
                type="search"
                value={place}
                placeholder={DEFAULT_PLACE.label}
                onChange={(e) => setPlace(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="find-radius">Radius</label>
              <select id="find-radius" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
                {RADII.map((r) => (
                  <option key={r} value={r}>
                    {r} miles
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {mode === 'online' && (
          <div className="field-group">
            <label htmlFor="find-language">Language</label>
            <select id="find-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {languages.map((l) => (
                <option key={l} value={l}>
                  {l === 'Any' ? 'Any language' : l}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field-group">
          <label htmlFor="find-day">Day</label>
          <select id="find-day" value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">Today</option>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="field-group">
          <label htmlFor="find-time">Starting at</label>
          <input id="find-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="field-group">
          <label htmlFor="find-hours">Show next</label>
          <select id="find-hours" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {WINDOWS.map((h) => (
              <option key={h} value={h}>
                {h} hours
              </option>
            ))}
          </select>
        </div>
        <div className="field-group find-wide">
          <label htmlFor="find-text">Name or keyword</label>
          <input
            id="find-text"
            type="search"
            value={text}
            placeholder={mode === 'online' ? 'e.g. Big Book, Brownbaggers' : 'e.g. Step Study, Alano'}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="find-actions">
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? 'Searching…' : 'Search'}
          </button>
          <button type="button" className="secondary-button" onClick={resetFilters} disabled={busy}>
            Reset
          </button>
        </div>
      </form>

      <p className="find-summary" aria-live="polite">
        {busy
          ? 'Searching…'
          : results
            ? `${results.length} meeting${results.length === 1 ? '' : 's'} ${
                mode === 'in-person' ? `within ${radius} mi of ${origin.label.split(',').slice(0, 2).join(',')}` : 'online'
              } from ${format(searchStart(day, time), 'EEE h:mm a')}`
            : ''}
      </p>
      {notice && <p className="find-notice">{notice}</p>}
      {error && <p className="find-error">{error}</p>}

      {results && results.length === 0 && !busy && !error && (
        <p className="empty-state">No meetings found. Try a wider radius or a longer time window.</p>
      )}

      {groups.map((group) => (
        <div key={group.label} className="time-block">
          <h3 className="time-block-label">{group.label}</h3>
          {group.items.map((item) =>
            mode === 'in-person' ? (
              <InPersonCard key={(item as InPersonResult).key + item.start.getTime()} m={item as InPersonResult} onLog={onLog} />
            ) : (
              <OnlineCard key={(item as OnlineMeeting).key} m={item as OnlineMeeting} onLog={onLog} />
            )
          )}
        </div>
      ))}

      {results && results.length > shown && (
        <button type="button" className="secondary-button show-more" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({results.length - shown} left)
        </button>
      )}

      <p className="find-credit">
        Meeting data from{' '}
        {mode === 'online' ? (
          <a href="https://aa-intergroup.org/meetings/" target="_blank" rel="noreferrer">
            Online Intergroup of A.A.
          </a>
        ) : (
          <>
            <a href="https://www.eastsideaa.org/meetings/" target="_blank" rel="noreferrer">
              Eastside A.A.
            </a>{' '}
            and{' '}
            <a href="https://www.seattleaa.org/meetings/" target="_blank" rel="noreferrer">
              Greater Seattle A.A.
            </a>
            {venueCount ? ` (${venueCount} locations)` : ''}
          </>
        )}
        . Please confirm details with the group.
      </p>
    </section>
  )
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <div className="tag-row">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </div>
  )
}

function Notes({ text }: { text?: string }) {
  if (!text) return null
  return (
    <details className="meeting-notes">
      <summary>Details</summary>
      <p>{text}</p>
    </details>
  )
}

function InPersonCard({ m, onLog }: { m: InPersonResult; onLog: (d: LogDraft) => void }) {
  const minutes = m.endTime
    ? (() => {
        const [sh, sm] = m.time.split(':').map(Number)
        const [eh, em] = m.endTime.split(':').map(Number)
        const diff = eh * 60 + em - (sh * 60 + sm)
        return diff > 0 ? diff : 60
      })()
    : 60

  return (
    <article className={m.pinned ? 'meeting-card pinned' : 'meeting-card'}>
      <div className="meeting-head">
        <h4>{m.name}</h4>
        <span className="distance">{m.distance < 0.1 ? 'here' : `${m.distance.toFixed(1)} mi`}</span>
      </div>
      <div className="meeting-when">
        {format(m.start, 'EEE h:mm a')}
        {m.endTime ? ` – ${format(new Date(`2000-01-01T${m.endTime}`), 'h:mm a')}` : ''} · {relative(m.start)}
      </div>
      <div className="meeting-where">
        <strong>{m.location}</strong>
        {m.address && m.address !== m.location ? <span>{m.address.replace(/, USA$/, '')}</span> : null}
        {m.locationNotes ? <span className="muted">{m.locationNotes}</span> : null}
      </div>
      <div className="meeting-buttons">
        <a className="primary-button link-button" href={appleMapsUrl(m)} target="_blank" rel="noreferrer">
          Get Directions
        </a>
        {m.hybrid && m.conferenceUrl && (
          <a className="secondary-button link-button" href={m.conferenceUrl} target="_blank" rel="noreferrer">
            Join online
          </a>
        )}
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            saveAs(
              calendarFile({ name: m.name, start: m.start, minutes, location: m.address || m.location, details: m.notes }),
              `${m.name}.ics`
            )
          }
        >
          Calendar
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onLog({ type: 'In-Person', dateTime: m.start.toISOString(), location: m.location, durationMinutes: minutes })
          }
        >
          Log
        </button>
      </div>
      <Tags tags={[...(m.pinned ? ['Alano Club'] : []), ...(m.hybrid ? ['Hybrid'] : []), ...m.types.map(typeLabel)]} />
      <Notes text={m.notes} />
      {m.url && (
        <a className="source-link" href={m.url} target="_blank" rel="noreferrer">
          View on {m.source}
        </a>
      )}
    </article>
  )
}

function OnlineCard({ m, onLog }: { m: OnlineMeeting; onLog: (d: LogDraft) => void }) {
  const meetingTz = m.timezone && m.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone ? m.timezone : undefined
  const theirTime = meetingTz
    ? new Intl.DateTimeFormat('en-US', { timeZone: meetingTz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(
        m.start
      )
    : undefined

  return (
    <article className="meeting-card">
      <h4>{m.name}</h4>
      <div className="meeting-when">
        {format(m.start, 'EEEE h:mm a')} · {relative(m.start)}
        {theirTime ? <span className="muted"> ({theirTime} where the group meets)</span> : null}
      </div>
      <div className="meeting-buttons">
        {m.conferenceUrl && (
          <a className="primary-button link-button" href={m.conferenceUrl} target="_blank" rel="noreferrer">
            {/zoom\./i.test(m.conferenceUrl) ? 'Join Zoom' : 'Join'}
          </a>
        )}
        {m.dialString && (
          <a className="secondary-button link-button" href={`tel:${m.dialString}`}>
            Dial in
          </a>
        )}
      </div>
      {(m.conferenceNotes || m.phone) && (
        <div className="conference-notes">
          {m.conferenceNotes && <div>{m.conferenceNotes}</div>}
          {m.phone && (
            <div>
              Phone: {m.phone}
              {m.phoneNotes ? ` · ${m.phoneNotes}` : ''}
            </div>
          )}
        </div>
      )}
      <Notes text={m.notes} />
      <div className="meeting-buttons">
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
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            saveAs(
              calendarFile({
                name: m.name,
                start: m.start,
                minutes: m.duration,
                location: m.conferenceUrl,
                details: [m.conferenceNotes, m.notes].filter(Boolean).join('\n\n')
              }),
              `${m.name}.ics`
            )
          }
        >
          Calendar
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onLog({ type: 'Online', dateTime: m.start.toISOString(), location: m.name, durationMinutes: m.duration })
          }
        >
          Log
        </button>
      </div>
      <Tags tags={[...m.tags, ...m.languages]} />
    </article>
  )
}
