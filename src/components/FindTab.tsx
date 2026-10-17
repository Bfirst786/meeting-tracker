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
import { v4 as uuidv4 } from 'uuid'
import { EntryType, SavedMeeting } from '../types'
import { appendEntry, rememberLocation } from '../utils/storage'
import { LocationPicker, MeetingDetails, StarRating } from './EntryFields'

/** What a search result hands to the "Save to Track" dialog. */
interface SaveDraft {
  type: EntryType
  location: string
  meeting: SavedMeeting
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

export default function FindTab({ onViewTrack }: { onViewTrack: () => void }) {
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
  const [pending, setPending] = useState<SaveDraft | null>(null)
  const [saved, setSaved] = useState('')

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
              <InPersonCard key={(item as InPersonResult).key + item.start.getTime()} m={item as InPersonResult} onSave={setPending} />
            ) : (
              <OnlineCard key={(item as OnlineMeeting).key} m={item as OnlineMeeting} onSave={setPending} />
            )
          )}
        </div>
      ))}

      {results && results.length > shown && (
        <button type="button" className="secondary-button show-more" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({results.length - shown} left)
        </button>
      )}

      {pending && (
        <SaveDialog
          draft={pending}
          onCancel={() => setPending(null)}
          onSaved={(name) => {
            setPending(null)
            setSaved(name)
            window.setTimeout(() => setSaved(''), 6000)
          }}
        />
      )}

      {saved && (
        <div className="toast" role="status">
          <span>Saved “{saved}” to Track</span>
          <button type="button" onClick={onViewTrack}>
            View
          </button>
        </div>
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

function InPersonCard({ m, onSave }: { m: InPersonResult; onSave: (d: SaveDraft) => void }) {
  const minutes = m.endTime
    ? (() => {
        const [sh, sm] = m.time.split(':').map(Number)
        const [eh, em] = m.endTime.split(':').map(Number)
        const diff = eh * 60 + em - (sh * 60 + sm)
        return diff > 0 ? diff : 60
      })()
    : 60

  const tags = [...(m.pinned ? ['Alano Club'] : []), ...(m.hybrid ? ['Hybrid'] : []), ...m.types.map(typeLabel)]
  const save = () =>
    onSave({
      type: 'In-Person',
      location: m.location,
      meeting: {
        kind: 'in-person',
        name: m.name,
        start: m.start.toISOString(),
        minutes,
        location: m.location,
        address: m.address.replace(/, USA$/, '') || undefined,
        locationNotes: m.locationNotes,
        mapsUrl: appleMapsUrl(m),
        conferenceUrl: m.hybrid ? m.conferenceUrl : undefined,
        notes: m.notes,
        tags,
        sourceName: m.source,
        sourceUrl: m.url
      }
    })

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
        <button type="button" className="secondary-button save-button" onClick={save}>
          Save to Track
        </button>
      </div>
      <Tags tags={tags} />
      <Notes text={m.notes} />
      {m.url && (
        <a className="source-link" href={m.url} target="_blank" rel="noreferrer">
          View on {m.source}
        </a>
      )}
    </article>
  )
}

function OnlineCard({ m, onSave }: { m: OnlineMeeting; onSave: (d: SaveDraft) => void }) {
  const meetingTz = m.timezone && m.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone ? m.timezone : undefined
  const theirTime = meetingTz
    ? new Intl.DateTimeFormat('en-US', { timeZone: meetingTz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(
        m.start
      )
    : undefined
  const tags = [...m.tags, ...m.languages]
  const save = () =>
    onSave({
      type: 'Online',
      location: '',
      meeting: {
        kind: 'online',
        name: m.name,
        start: m.start.toISOString(),
        minutes: m.duration,
        conferenceUrl: m.conferenceUrl,
        conferenceNotes: m.conferenceNotes,
        phone: m.phone,
        dialString: m.dialString,
        email: m.email,
        website: m.website,
        notes: m.notes,
        tags,
        groupTime: theirTime,
        sourceName: 'Online Intergroup of A.A.',
        sourceUrl: 'https://aa-intergroup.org/meetings/'
      }
    })

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
        <button type="button" className="secondary-button save-button" onClick={save}>
          Save to Track
        </button>
      </div>
      <Tags tags={tags} />
    </article>
  )
}

function SaveDialog({ draft, onCancel, onSaved }: { draft: SaveDraft; onCancel: () => void; onSaved: (name: string) => void }) {
  const [rating, setRating] = useState<number | undefined>()
  const [note, setNote] = useState('')
  const [location, setLocation] = useState(draft.location)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { meeting } = draft

  // Venues found by search join the location list so they show up in the Track pull-down.
  useEffect(() => {
    if (draft.type === 'In-Person') void rememberLocation(draft.location)
  }, [draft])

  const save = async () => {
    setSaving(true)
    try {
      const now = new Date().toISOString()
      await appendEntry({
        id: uuidv4(),
        type: draft.type,
        dateTime: meeting.start,
        durationMinutes: meeting.minutes,
        location: location || undefined,
        rating,
        note: note.trim() || undefined,
        meeting,
        createdAt: now,
        updatedAt: now
      })
      onSaved(meeting.name)
    } catch (err) {
      setError(`Couldn't save: ${(err as Error).message}`)
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="save-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="save-title">Save as a Track entry?</h3>
        <div className="save-summary">
          <strong>{meeting.name}</strong>
          <span className="muted">
            {draft.type} · {format(new Date(meeting.start), 'EEE MMM d, h:mm a')}
            {meeting.minutes ? ` · ${meeting.minutes} min` : ''}
          </span>
        </div>
        <MeetingDetails m={meeting} />
        <LocationPicker id="save-location" value={location} onChange={setLocation} />
        <div className="field-group">
          <span className="field-label">Rating</span>
          <StarRating value={rating} onChange={setRating} />
        </div>
        <div className="field-group">
          <label htmlFor="save-notes">Notes (optional)</label>
          <textarea id="save-notes" rows={3} value={note} placeholder="How was the meeting?" onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="find-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Yes, save'}
          </button>
        </div>
      </div>
    </div>
  )
}
