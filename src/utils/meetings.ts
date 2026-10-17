import localforage from 'localforage'

// Meeting Guide (TSML) feeds for in-person meetings near the Eastside.
// Both send `Access-Control-Allow-Origin: *`, so the browser can read them directly.
export const IN_PERSON_FEEDS = [
  { name: 'Eastside A.A.', url: 'https://www.eastsideaa.org/wp-admin/admin-ajax.php?action=meetings' },
  { name: 'Greater Seattle A.A.', url: 'https://www.seattleaa.org/wp-admin/admin-ajax.php?action=meetings' }
]

// Code4Recovery's central query API — the data behind aa-intergroup.org's online meeting list.
export const ONLINE_API = 'https://central-query.apps.code4recovery.org/api/v1/meetings'

export const DEFAULT_PLACE = { label: 'Redmond, WA 98052', lat: 47.6787, lng: -122.1218 }

const FEED_CACHE_HOURS = 12
const cache = localforage.createInstance({ name: 'meeting-tracker', storeName: 'feeds' })

export interface Place {
  label: string
  lat: number
  lng: number
}

/* ---------- In-person ---------- */

interface TsmlMeeting {
  id?: number
  name?: string
  day?: number | string
  time?: string
  end_time?: string
  types?: string[]
  notes?: string
  location?: string
  location_notes?: string
  formatted_address?: string
  latitude?: number | string
  longitude?: number | string
  attendance_option?: string
  url?: string
  conference_url?: string
  approximate?: string
}

export interface InPersonMeeting {
  key: string
  name: string
  day: number
  time: string
  endTime?: string
  types: string[]
  notes?: string
  location: string
  locationNotes?: string
  address: string
  lat: number
  lng: number
  hybrid: boolean
  conferenceUrl?: string
  url?: string
  source: string
}

export interface InPersonResult extends InPersonMeeting {
  start: Date
  distance: number
  pinned: boolean
}

export interface FeedLoad<T> {
  data: T
  fetchedAt: number
  stale: boolean
  errors: string[]
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

/** Feeds sometimes carry HTML entities ("12 &amp; 12"); show them as plain text. */
export const decodeEntities = (value?: string) =>
  value
    ?.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .trim()

const dedupeKey = (name: string, day: number, time: string, location: string) =>
  [name, location].map((v) => v.toLowerCase().replace(/[^a-z0-9]/g, '')).join('|') + `|${day}|${time}`

const normalizeTsml = (raw: TsmlMeeting[], source: string): InPersonMeeting[] =>
  raw.flatMap((m) => {
    const lat = Number(m.latitude)
    const lng = Number(m.longitude)
    const day = Number(m.day)
    const option = m.attendance_option ?? 'in_person'
    if (!m.name || !m.time || Number.isNaN(day) || !Number.isFinite(lat) || !Number.isFinite(lng)) return []
    if (option !== 'in_person' && option !== 'hybrid') return []
    if (m.approximate === 'yes') return []
    const name = decodeEntities(m.name) ?? ''
    const location = decodeEntities(m.location) || m.formatted_address || ''
    const time = m.time.slice(0, 5)
    return [
      {
        key: dedupeKey(name, day, time, location),
        name,
        day,
        time,
        endTime: m.end_time?.slice(0, 5),
        types: m.types ?? [],
        notes: decodeEntities(m.notes) || undefined,
        location,
        locationNotes: decodeEntities(m.location_notes) || undefined,
        address: m.formatted_address ?? '',
        lat,
        lng,
        hybrid: option === 'hybrid',
        conferenceUrl: m.conference_url || undefined,
        url: m.url,
        source
      }
    ]
  })

export async function loadInPersonMeetings(force = false): Promise<FeedLoad<InPersonMeeting[]>> {
  const cached = await cache.getItem<{ data: InPersonMeeting[]; fetchedAt: number }>('in-person').catch(() => null)
  const fresh = cached && Date.now() - cached.fetchedAt < FEED_CACHE_HOURS * 3600_000
  if (cached && fresh && !force) return { ...cached, stale: false, errors: [] }

  const errors: string[] = []
  const results = await Promise.all(
    IN_PERSON_FEEDS.map(async (feed) => {
      try {
        const res = await fetch(feed.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return normalizeTsml((await res.json()) as TsmlMeeting[], feed.name)
      } catch (error) {
        errors.push(`${feed.name}: ${(error as Error).message}`)
        return []
      }
    })
  )

  // Feeds overlap at their borders; keep the first copy of each meeting.
  const seen = new Set<string>()
  const data = results.flat().filter((m) => (seen.has(m.key) ? false : (seen.add(m.key), true)))

  if (data.length === 0 && cached) return { ...cached, stale: true, errors }
  if (data.length > 0) await cache.setItem('in-person', { data, fetchedAt: Date.now() }).catch(() => undefined)
  return { data, fetchedAt: Date.now(), stale: false, errors }
}

export const milesBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(h))
}

export const isAlanoClub = (m: Pick<InPersonMeeting, 'location' | 'address'>) =>
  /alano club of the eastside/i.test(m.location) || /12302 NE 8th/i.test(m.address)

/** Every weekly occurrence of each meeting that starts inside [start, end), within the radius. */
export function findInPerson(
  meetings: InPersonMeeting[],
  opts: { origin: Place; radius: number; start: Date; end: Date; pinAlano: boolean; text?: string }
): InPersonResult[] {
  const text = opts.text?.trim().toLowerCase()
  const firstDay = new Date(opts.start)
  firstDay.setHours(0, 0, 0, 0)
  const spanDays = Math.ceil((opts.end.getTime() - firstDay.getTime()) / 86400_000)

  const results: InPersonResult[] = []
  for (const m of meetings) {
    const distance = milesBetween(opts.origin, m)
    if (distance > opts.radius) continue
    if (text && !`${m.name} ${m.location} ${m.address} ${m.notes ?? ''}`.toLowerCase().includes(text)) continue

    const [h, min] = m.time.split(':').map(Number)
    for (let offset = 0; offset < spanDays; offset += 1) {
      const date = new Date(firstDay)
      date.setDate(firstDay.getDate() + offset)
      if (date.getDay() !== m.day) continue
      date.setHours(h, min, 0, 0)
      if (date >= opts.start && date < opts.end) {
        results.push({ ...m, start: date, distance, pinned: opts.pinAlano && isAlanoClub(m) })
      }
    }
  }

  return results.sort(
    (a, b) =>
      a.start.getTime() - b.start.getTime() ||
      Number(b.pinned) - Number(a.pinned) ||
      a.distance - b.distance ||
      a.name.localeCompare(b.name)
  )
}

export async function geocode(query: string, meetings: InPersonMeeting[]): Promise<Place | null> {
  const q = query.trim()
  if (!q) return null

  // A meeting venue name (e.g. "Alano Club") resolves locally without a network call.
  const venue = meetings.find((m) => m.location.toLowerCase().includes(q.toLowerCase()))
  if (venue && q.length >= 4) return { label: venue.location, lat: venue.lat, lng: venue.lng }

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Location lookup failed (HTTP ${res.status})`)
  const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[]
  return hit ? { label: hit.display_name, lat: Number(hit.lat), lng: Number(hit.lon) } : null
}

/* ---------- Online ---------- */

interface CentralMeeting {
  slug?: string
  name?: string
  timezone?: string
  duration?: number
  conference_url?: string
  conference_url_notes?: string
  conference_phone?: string | null
  conference_phone_notes?: string
  notes?: string
  groupNotes?: string
  groupEmail?: string
  groupWebsite?: string
  languages?: string[]
  formats?: string[]
  features?: string[]
  communities?: string[]
  type?: string
  nextEventUTC?: string
  timeUTC?: string
}

export interface OnlineMeeting {
  key: string
  name: string
  start: Date
  duration: number
  timezone?: string
  conferenceUrl?: string
  conferenceNotes?: string
  phone?: string
  phoneNotes?: string
  dialString?: string
  meetingId?: string
  passcode?: string
  notes?: string
  email?: string
  website?: string
  tags: string[]
  languages: string[]
}

const languageName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

const meetingIdFrom = (url?: string, notes?: string) => {
  const fromUrl = url?.match(/\/j\/(\d{9,11})/)?.[1]
  const fromNotes = notes?.match(/(?:meeting\s*)?id[:\s#]*([\d\s]{9,14})/i)?.[1]?.replace(/\s/g, '')
  return fromUrl ?? fromNotes
}

const passcodeFrom = (notes?: string) => notes?.match(/(?:passcode|password|pwd|pw)[:\s]*([^\s,;]+)/i)?.[1]

export const normalizeOnline = (raw: CentralMeeting[]): OnlineMeeting[] =>
  raw.flatMap((m) => {
    const startIso = m.nextEventUTC ?? m.timeUTC
    if (!m.name || !startIso) return []
    // Some feeds paste URLs with stray spaces ("zoom.us/j/ 889…?pwd= abc").
    const conferenceUrl = m.conference_url?.replace(/\s+/g, '') || undefined
    const meetingId = meetingIdFrom(conferenceUrl, m.conference_url_notes)
    const passcode = passcodeFrom(m.conference_url_notes)
    const phone = m.conference_phone?.trim() || undefined
    // Some groups already put the whole dial sequence in the phone field ("+1415…,,7144993468#").
    const dialString = !phone
      ? undefined
      : /[,#]/.test(phone)
        ? phone.replace(/[^\d+,#*]/g, '')
        : meetingId
          ? `${phone.replace(/[^\d+]/g, '')},,${meetingId}#${passcode && /^\d+$/.test(passcode) ? `,,,,*${passcode}#` : ''}`
          : phone.replace(/[^\d+]/g, '')

    const tags = [
      m.type === 'C' ? 'Closed' : m.type === 'O' ? 'Open' : undefined,
      ...(m.formats ?? []),
      ...(m.features ?? []),
      ...(m.communities ?? [])
    ].filter((t): t is string => Boolean(t))

    return [
      {
        key: `${m.slug ?? m.name}|${startIso}`,
        name: decodeEntities(m.name) ?? m.name,
        start: new Date(startIso),
        duration: m.duration ?? 60,
        timezone: m.timezone,
        conferenceUrl,
        conferenceNotes: decodeEntities(m.conference_url_notes) || undefined,
        phone,
        phoneNotes: m.conference_phone_notes?.trim() || undefined,
        dialString,
        meetingId,
        passcode,
        notes: decodeEntities([m.notes, m.groupNotes].filter(Boolean).join('\n\n')) || undefined,
        email: m.groupEmail || undefined,
        website: m.groupWebsite || undefined,
        tags,
        languages: (m.languages ?? []).map(languageName)
      }
    ]
  })

export async function findOnline(start: Date, hours: number): Promise<OnlineMeeting[]> {
  const url = `${ONLINE_API}?start=${encodeURIComponent(start.toISOString())}&hours=${hours}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Online meeting search failed (HTTP ${res.status})`)
  const end = start.getTime() + hours * 3600_000
  return normalizeOnline((await res.json()) as CentralMeeting[])
    .filter((m) => m.start.getTime() >= start.getTime() - 5 * 60_000 && m.start.getTime() < end)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.name.localeCompare(b.name))
}

/* ---------- Shared ---------- */

// Common Meeting Guide type codes → readable labels.
const TYPE_LABELS: Record<string, string> = {
  O: 'Open', C: 'Closed', D: 'Discussion', B: 'Big Book', SP: 'Speaker', ST: 'Step Study', TR: 'Tradition Study',
  '12x12': '12 Steps & 12 Traditions', LIT: 'Literature', DR: 'Daily Reflections', ABSI: 'As Bill Sees It',
  MED: 'Meditation', CAN: 'Candlelight', BE: 'Newcomer', BEG: 'Beginner', M: 'Men', W: 'Women', Y: 'Young People',
  LGBTQ: 'LGBTQ', S: 'Spanish', EN: 'English', X: 'Wheelchair Access', XB: 'Wheelchair-Accessible Bathroom',
  BA: 'Babysitting', CF: 'Child-Friendly', FF: 'Fragrance Free', ASL: 'ASL', H: 'Birthday', GR: 'Grapevine',
  SM: 'Smoking Permitted', NS: 'Non-Smoking', A: 'Secular', T: 'Transgender', SEN: 'Seniors', P: 'Professionals',
  OUT: 'Outdoor', ONL: 'Online', TC: 'Location Temporarily Closed', 'AL-AN': 'Concurrent with Al-Anon', G: 'Gay', L: 'Lesbian'
}

export const typeLabel = (code: string) => TYPE_LABELS[code] ?? code

export const appleMapsUrl = (m: { lat: number; lng: number; location: string; address: string }) =>
  `https://maps.apple.com/?daddr=${encodeURIComponent(m.address || `${m.lat},${m.lng}`)}&q=${encodeURIComponent(
    m.location
  )}&dirflg=d`

/** An .ics file iOS opens straight into "Add to Calendar". */
export function calendarFile(event: { name: string; start: Date; minutes: number; location?: string; details?: string }) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')
  const end = new Date(event.start.getTime() + event.minutes * 60_000)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meeting Tracker//EN',
    'BEGIN:VEVENT',
    `UID:${stamp(event.start)}-${Math.random().toString(36).slice(2)}@meeting-tracker`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(event.name)}`,
    event.location ? `LOCATION:${esc(event.location)}` : '',
    event.details ? `DESCRIPTION:${esc(event.details)}` : '',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean)
  return new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
}
