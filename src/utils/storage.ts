import localforage from 'localforage'
import { Entry } from '../types'

const store = localforage.createInstance({
  name: 'meeting-tracker',
  storeName: 'entries'
})

export async function loadEntries(): Promise<Entry[]> {
  try {
    const saved = await store.getItem<Entry[]>('items')
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

export async function saveEntries(entries: Entry[]): Promise<void> {
  await store.setItem('items', entries)
}

/** Adds one entry without the Track tab being open (used by the Find tab). */
export async function appendEntry(entry: Entry): Promise<void> {
  const current = await loadEntries()
  await saveEntries([entry, ...current])
}

/* ---------- Saved locations (order is user-defined) ---------- */

const settings = localforage.createInstance({ name: 'meeting-tracker', storeName: 'settings' })
const DEFAULT_LOCATIONS = ['Alano Club of the Eastside', 'Zoom', 'Phone']

export async function loadLocations(): Promise<string[]> {
  try {
    const saved = await settings.getItem<string[]>('locations')
    if (Array.isArray(saved)) return saved
  } catch {
    /* fall through to defaults */
  }
  // First run: start from the defaults plus any locations already used in entries.
  const used = (await loadEntries()).map((e) => e.location?.trim()).filter((l): l is string => Boolean(l))
  const seeded = [...new Set([...DEFAULT_LOCATIONS, ...used])]
  await saveLocations(seeded)
  return seeded
}

export async function saveLocations(list: string[]): Promise<void> {
  await settings.setItem('locations', list)
}

/** Adds a location to the end of the list if it isn't already there. */
export async function rememberLocation(name?: string): Promise<void> {
  const value = name?.trim()
  if (!value) return
  const list = await loadLocations()
  if (!list.some((l) => l.toLowerCase() === value.toLowerCase())) await saveLocations([...list, value])
}
