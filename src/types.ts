export type EntryType = 'Online' | 'In-Person' | 'Call' | 'Manual'

export interface Entry {
  id: string
  type: EntryType
  note?: string
  dateTime: string
  durationMinutes?: number
  createdAt: string
  updatedAt?: string
}
