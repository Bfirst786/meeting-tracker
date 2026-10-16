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
