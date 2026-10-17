# meeting-tracker
Meeting Attendance Tracker — PWA, local IndexedDB, export & graph

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the app:
   ```bash
   npm run dev
   ```
3. Build for production:
   ```bash
   npm run build
   ```

## Features
- Simple meeting attendance tracker
- Buttons for Online, In-Person, Call, Manual
- Manual note entry support
- Date & time selector
- Optional duration and location entry
- Search entries by location or note, type, date, day of week, and time range
- Find tab: search upcoming AA meetings
  - In-Person: Eastside & Greater Seattle A.A. lists, by radius from Redmond (or any place), grouped by start time and sorted nearest first, Alano Club of the Eastside pinned first, Apple Maps directions
  - Online: Online Intergroup of A.A. list with Zoom join, one-tap dial-in, meeting ID/passcode, notes, email and calendar
  - "Log" pre-fills an attendance entry from any result
- Edit and delete entries
- Local storage using IndexedDB via localforage
- Export to text, CSV, Excel, PDF, and graph view
- Copy output to clipboard
- Mobile-friendly installable PWA

## Notes
This is a personal tracker and does not request permissions.
