export type EntryType = 'Online' | 'In-Person' | 'Call' | 'Manual'

/** A snapshot of a meeting picked on the Find tab, kept with the entry so its links still work later. */
export interface SavedMeeting {
  kind: 'in-person' | 'online'
  name: string
  start: string
  minutes?: number
  location?: string
  address?: string
  locationNotes?: string
  mapsUrl?: string
  conferenceUrl?: string
  conferenceNotes?: string
  phone?: string
  dialString?: string
  email?: string
  website?: string
  notes?: string
  tags: string[]
  groupTime?: string
  sourceName?: string
  sourceUrl?: string
}

export interface Entry {
  id: string
  type: EntryType
  note?: string
  location?: string
  dateTime: string
  durationMinutes?: number
  /** 1–5 stars; absent when not rated. */
  rating?: number
  meeting?: SavedMeeting
  createdAt: string
  updatedAt?: string
}
