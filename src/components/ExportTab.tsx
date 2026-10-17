import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { saveAs } from 'file-saver'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Title, Tooltip } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import * as XLSX from 'xlsx'
import { Entry } from '../types'
import { loadEntries } from '../utils/storage'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

type ExportFormat = 'text' | 'table' | 'xls' | 'pdf' | 'graph'

const prepareRows = (entries: Entry[]) =>
  entries.map((entry) => ({
    Date: format(new Date(entry.dateTime), 'yyyy-MM-dd'),
    Time: format(new Date(entry.dateTime), 'HH:mm'),
    Type: entry.type,
    Location: entry.location ?? '',
    Note: entry.note ?? '',
    Duration: entry.durationMinutes ?? ''
  }))

const buildTextOutput = (entries: Entry[]) => {
  if (entries.length === 0) return 'No entries in range.'

  return prepareRows(entries)
    .map((row) => `${row.Date} ${row.Time} — ${row.Type}${row.Location ? ` @ ${row.Location}` : ''}${row.Note ? ` — ${row.Note}` : ''}${row.Duration ? ` (${row.Duration} min)` : ''}`)
    .join('\n')
}

export default function ExportTab() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('text')
  const [preview, setPreview] = useState('')
  const chartRef = useRef<ChartJS<'bar'>>(null)

  useEffect(() => {
    const init = async () => {
      const all = await loadEntries()
      setEntries(all)
    }
    void init()
  }, [])

  const filtered = useMemo(() => {
    let result = [...entries].sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())

    if (startDate) {
      result = result.filter((entry) => new Date(entry.dateTime) >= new Date(`${startDate}T00:00:00`))
    }

    if (endDate) {
      result = result.filter((entry) => new Date(entry.dateTime) <= new Date(`${endDate}T23:59:59`))
    }

    return result
  }, [entries, startDate, endDate])

  useEffect(() => {
    setPreview(buildTextOutput(filtered))
  }, [filtered])

  const chartData = useMemo(() => {
    const dateTotals = new Map<string, number>()

    filtered.forEach((entry) => {
      const dateKey = format(new Date(entry.dateTime), 'yyyy-MM-dd')
      dateTotals.set(dateKey, (dateTotals.get(dateKey) ?? 0) + 1)
    })

    const labels = [...dateTotals.keys()].sort()
    const values = labels.map((label) => dateTotals.get(label) ?? 0)

    return {
      labels,
      datasets: [
        {
          label: 'Meetings',
          data: values,
          backgroundColor: '#0b76ef',
          borderRadius: 6
        }
      ]
    }
  }, [filtered])

  const downloadText = (text: string, name: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    saveAs(blob, name)
  }

  const downloadCsv = () => {
    const rows = prepareRows(filtered)
    const csv = [
      ['Date', 'Time', 'Type', 'Location', 'Note', 'Duration'],
      ...rows.map((row) => [row.Date, row.Time, row.Type, row.Location, row.Note, String(row.Duration)])
    ]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    downloadText(csv, `meeting-tracker-${Date.now()}.csv`)
  }

  const downloadXlsx = () => {
    const rows = prepareRows(filtered)
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Entries')

    const workbookBuffer = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'array'
    })

    saveAs(new Blob([workbookBuffer], { type: 'application/octet-stream' }), `meeting-tracker-${Date.now()}.xlsx`)
  }

  const downloadPdf = () => {
    const doc = new jsPDF()
    const rows = prepareRows(filtered)
    const body = rows.map((row) => [row.Date, row.Time, row.Type, row.Location, row.Note, String(row.Duration)])

    autoTable(doc, {
      head: [['Date', 'Time', 'Type', 'Location', 'Note', 'Duration']],
      body,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [11, 118, 239] }
    })

    doc.save(`meeting-tracker-${Date.now()}.pdf`)
  }

  const handleExport = () => {
    if (exportFormat === 'text') {
      downloadText(preview || 'No entries in range.', `meeting-tracker-${Date.now()}.txt`)
      return
    }

    if (exportFormat === 'table') {
      downloadCsv()
      return
    }

    if (exportFormat === 'xls') {
      downloadXlsx()
      return
    }

    if (exportFormat === 'pdf') {
      downloadPdf()
      return
    }

    if (exportFormat === 'graph') {
      const chart = chartRef.current
      if (!chart) return
      const link = document.createElement('a')
      link.href = chart.toBase64Image('image/png', 1)
      link.download = `meeting-tracker-${Date.now()}.png`
      link.click()
    }
  }

  const handleCopy = async () => {
    const text = preview || buildTextOutput(filtered)
    await navigator.clipboard.writeText(text)
    alert('Copied to clipboard')
  }

  return (
    <section className="card panel">
      <div className="export-toolbar">
        <label>
          Start date
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>

        <label>
          End date
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>

        <label>
          Export format
          <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)}>
            <option value="text">Text only</option>
            <option value="table">Table (CSV)</option>
            <option value="xls">Excel (.xls/.xlsx)</option>
            <option value="pdf">PDF</option>
            <option value="graph">Graph</option>
          </select>
        </label>

        <button type="button" className="primary-button" onClick={handleExport}>
          Export
        </button>
        <button type="button" className="secondary-button" onClick={handleCopy}>
          Copy
        </button>
      </div>

      <div className="preview-section">
        <h2>Preview</h2>
        <pre className="preview-box">{preview || 'No entries in range.'}</pre>
      </div>

      {exportFormat === 'graph' && (
        <div className="chart-section">
          <h2>Attendance graph</h2>
          <div className="chart-wrap">
            <Bar
              ref={chartRef}
              data={chartData}
              options={{
                responsive: true,
                plugins: {
                  legend: { display: false },
                  title: { display: true, text: 'Entries per day' }
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                  }
                }
              }}
            />
          </div>
        </div>
      )}
    </section>
  )
}
