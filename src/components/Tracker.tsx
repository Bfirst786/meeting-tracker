import { FormEvent, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'
import { Entry, EntryType } from '../types'
import { loadEntries, saveEntries } from '../utils/storage'

const BUTTONS: EntryType[] = ['Online', 'In-Person', 'Call', 'Manual']

const toLocalDateTimeValue = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export default function Tracker() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [selectedType, setSelectedType] = useState<EntryType>('Online')
  const [note, setNote] = useState('')
  const [dateTime, setDateTime] = useState<string>(() => toLocalDateTimeValue())
  const [duration, setDuration] = useState<string>('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
    setDateTime(toLocalDateTimeValue())
    setDuration('')
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
      note: selectedType === 'Manual' ? note.trim() : undefined,
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
    setDateTime(toLocalDateTimeValue(new Date(item.dateTime)))
    setDuration(item.durationMinutes != null ? String(item.durationMinutes) : '')
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

          <div className="field-group duration-group">
            <label htmlFor="meeting-duration">Duration (min)</label>
            <input
              id="meeting-duration"
              type="number"
              min="0"
              value={duration}
              placeholder="Optional"
              onChange={(event) => setDuration(event.target.value)}
            />
          </div>
        </div>

        <div className="entry-actions">
          {selectedType === 'Manual' && (
            <input
              type="text"
              value={note}
              placeholder="Add a manual note..."
              onChange={(event) => setNote(event.target.value)}
            />
          )}

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
        <h2>Entries</h2>
        {entries.length === 0 ? <p className="empty-state">No entries logged yet.</p> : null}

        {entries.map((entry) => (
          <div key={entry.id} className="entry-row">
            <div>
              <div className="entry-title">
                {entry.type}
                {entry.note ? ` — ${entry.note}` : ''}
              </div>
              <div className="entry-meta">
                {format(new Date(entry.dateTime), 'yyyy-MM-dd HH:mm')} • {entry.durationMinutes ?? '—'} min
              </div>
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
