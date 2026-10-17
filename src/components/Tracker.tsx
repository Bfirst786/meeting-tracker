import { FormEvent, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'
import { Entry, EntryType } from '../types'
import { loadEntries, saveEntries } from '../utils/storage'
import { DurationPicker, LocationPicker, MeetingDetails, StarRating } from './EntryFields'

const BUTTONS: EntryType[] = ['Online', 'In-Person', 'Call', 'Manual']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface SearchFilters {
  text: string
  type: '' | EntryType
  date: string
  weekday: string
  timeFrom: string
  timeTo: string
}

const EMPTY_FILTERS: SearchFilters = { text: '', type: '', date: '', weekday: '', timeFrom: '', timeTo: '' }

const matchesFilters = (entry: Entry, filters: SearchFilters) => {
  const when = new Date(entry.dateTime)
  const text = filters.text.trim().toLowerCase()

  if (text) {
    const haystack = [entry.location, entry.note, entry.type, entry.meeting?.name].filter(Boolean).join(' ').toLowerCase()
    if (!haystack.includes(text)) return false
  }

  if (filters.type && entry.type !== filters.type) return false
  if (filters.date && format(when, 'yyyy-MM-dd') !== filters.date) return false
  if (filters.weekday !== '' && when.getDay() !== Number(filters.weekday)) return false

  const time = format(when, 'HH:mm')
  const { timeFrom, timeTo } = filters
  if (timeFrom && timeTo && timeFrom > timeTo) {
    // Range wraps past midnight, e.g. 22:00–02:00
    if (time < timeFrom && time > timeTo) return false
  } else {
    if (timeFrom && time < timeFrom) return false
    if (timeTo && time > timeTo) return false
  }

  return true
}

const toLocalDateTimeValue = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export default function Tracker() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [selectedType, setSelectedType] = useState<EntryType>('Online')
  const [note, setNote] = useState('')
  const [location, setLocation] = useState('')
  const [dateTime, setDateTime] = useState<string>(() => toLocalDateTimeValue())
  const [duration, setDuration] = useState<string>('')
  const [rating, setRating] = useState<number | undefined>()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS)
  const [showSearch, setShowSearch] = useState(false)

  const updateFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }))

  const hasFilters = Object.values(filters).some((value) => value !== '')

  const visibleEntries = useMemo(
    () =>
      entries
        .filter((entry) => matchesFilters(entry, filters))
        .sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime()),
    [entries, filters]
  )

  useEffect(() => {
    const init = async () => {
      const all = await loadEntries()
      setEntries(all)
      setLoading(false)
    }
    void init()
  }, [])

  useEffect(() => {
    if (!loading) {
      void saveEntries(entries)
    }
  }, [entries, loading])

  const resetForm = () => {
    setSelectedType('Online')
    setNote('')
    setLocation('')
    setDateTime(toLocalDateTimeValue())
    setDuration('')
    setRating(undefined)
  }

  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault()

    const parsedDuration = duration.trim() === '' ? undefined : Math.max(0, Number(duration))
    const entryDate = dateTime ? new Date(dateTime) : new Date()

    if (Number.isNaN(entryDate.getTime())) {
      return
    }

    const nextEntry: Entry = {
      id: editingId ?? uuidv4(),
      type: selectedType,
      note: note.trim() || undefined,
      rating,
      location: location.trim() || undefined,
      dateTime: entryDate.toISOString(),
      durationMinutes: parsedDuration ?? undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    if (editingId) {
      setEntries((current) =>
        current.map((item) => (item.id === editingId ? { ...item, ...nextEntry, createdAt: item.createdAt } : item))
      )
      setEditingId(null)
      resetForm()
      return
    }

    setEntries((current) => [nextEntry, ...current])
    resetForm()
  }

  const handleEdit = (id: string) => {
    const item = entries.find((entry) => entry.id === id)
    if (!item) return

    setEditingId(id)
    setSelectedType(item.type)
    setNote(item.note ?? '')
    setLocation(item.location ?? '')
    setDateTime(toLocalDateTimeValue(new Date(item.dateTime)))
    setDuration(item.durationMinutes != null ? String(item.durationMinutes) : '')
    setRating(item.rating)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = (id: string) => {
    setEntries((current) => current.filter((item) => item.id !== id))
  }

  return (
    <section className="card panel">
      <form onSubmit={handleSubmit}>
        <div className="toolbar">
          <div className="button-row" aria-label="Attendance type selector">
            {BUTTONS.map((button) => (
              <button
                key={button}
                type="button"
                className={selectedType === button ? 'type-button active' : 'type-button'}
                onClick={() => setSelectedType(button)}
              >
                {button}
              </button>
            ))}
          </div>

          <div className="field-group date-group">
            <label htmlFor="meeting-datetime">Date &amp; time</label>
            <input
              id="meeting-datetime"
              type="datetime-local"
              value={dateTime}
              onChange={(event) => setDateTime(event.target.value)}
            />
          </div>

          <DurationPicker value={duration} onChange={setDuration} />
        </div>

        <div className="entry-extras">
          <LocationPicker value={location} onChange={setLocation} />
          <div className="field-group">
            <span className="field-label">Rating</span>
            <StarRating value={rating} onChange={setRating} />
          </div>
          <div className="field-group entry-notes">
            <label htmlFor="entry-notes">Notes (optional)</label>
            <textarea
              id="entry-notes"
              rows={2}
              value={note}
              placeholder={selectedType === 'Manual' ? 'What was this?' : 'How was the meeting?'}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <div className="entry-actions">
          <button type="submit" className="primary-button">
            {editingId ? 'Save Entry' : 'Add Entry'}
          </button>
          {editingId && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setEditingId(null)
                resetForm()
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="entries-section">
        <div className="entries-header">
          <h2>Entries</h2>
          <button
            type="button"
            className={showSearch || hasFilters ? 'secondary-button active-outline' : 'secondary-button'}
            aria-expanded={showSearch}
            onClick={() => setShowSearch((open) => !open)}
          >
            Search{hasFilters ? ' •' : ''}
          </button>
        </div>

        {showSearch && (
          <div className="search-panel" role="search">
            <div className="field-group search-text">
              <label htmlFor="search-text">Location, meeting or note</label>
              <input
                id="search-text"
                type="search"
                value={filters.text}
                placeholder="e.g. Office, Zoom, Standup"
                onChange={(event) => updateFilter('text', event.target.value)}
              />
            </div>
            <div className="field-group search-type">
              <label htmlFor="search-type">Type</label>
              <select
                id="search-type"
                value={filters.type}
                onChange={(event) => updateFilter('type', event.target.value as SearchFilters['type'])}
              >
                <option value="">Any type</option>
                {BUTTONS.map((button) => (
                  <option key={button} value={button}>
                    {button}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="search-date">Date</label>
              <input
                id="search-date"
                type="date"
                value={filters.date}
                onChange={(event) => updateFilter('date', event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="search-weekday">Day of week</label>
              <select id="search-weekday" value={filters.weekday} onChange={(event) => updateFilter('weekday', event.target.value)}>
                <option value="">Any day</option>
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label htmlFor="search-from">From time</label>
              <input
                id="search-from"
                type="time"
                value={filters.timeFrom}
                onChange={(event) => updateFilter('timeFrom', event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="search-to">To time</label>
              <input
                id="search-to"
                type="time"
                value={filters.timeTo}
                onChange={(event) => updateFilter('timeTo', event.target.value)}
              />
            </div>
            <div className="search-footer">
              <span className="entry-meta">
                Showing {visibleEntries.length} of {entries.length}
              </span>
              <button type="button" className="secondary-button" disabled={!hasFilters} onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear
              </button>
            </div>
          </div>
        )}

        {entries.length === 0 ? <p className="empty-state">No entries logged yet.</p> : null}
        {entries.length > 0 && visibleEntries.length === 0 ? (
          <p className="empty-state">No entries match your search.</p>
        ) : null}

        {visibleEntries.map((entry) => (
          <div key={entry.id} className="entry-row">
            <div className="entry-body">
              <div className="entry-title">{entry.meeting?.name ?? entry.type}</div>
              <div className="entry-meta">
                {entry.meeting ? `${entry.type} • ` : ''}
                {format(new Date(entry.dateTime), 'EEE yyyy-MM-dd HH:mm')} • {entry.durationMinutes ?? '—'} min
                {entry.location ? ` • ${entry.location}` : ''}
              </div>
              {entry.rating ? <StarRating value={entry.rating} size="sm" /> : null}
              {entry.note ? <p className="entry-note">{entry.note}</p> : null}
              {entry.meeting ? <MeetingDetails m={entry.meeting} /> : null}
            </div>

            <div className="entry-controls">
              <button type="button" className="secondary-button" onClick={() => handleEdit(entry.id)}>
                Edit
              </button>
              <button type="button" className="secondary-button danger" onClick={() => handleDelete(entry.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
