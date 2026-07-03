import { useState } from 'react'
import './App.css'
import DocumentUploader from './DocumentUploader'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmt(date) {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d)) return '—'
  const hr  = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${d.getDate()} ${MONTHS[d.getMonth()]}  ${hr}:${min}`
}

function fmtHrs(n) {
  return n.toFixed(2)
}

function fmtUSD(n) {
  return '$' + Math.round(n).toLocaleString()
}

const TERMS_HELP = {
  SHINC: 'Sundays and holidays included — all time counts',
  SHEX:  'Sundays and holidays excluded from laytime count',
  WIBON: 'Laytime begins on berthing, whether in berth or not',
  WIPON: 'Laytime begins on arrival at port, whether in port or not',
}

// ─── Period building ──────────────────────────────────────────────────────────

function buildPeriods(commence, end, events, terms) {
  const bSet = new Set([commence.getTime(), end.getTime()])

  // Event boundaries clipped to [commence, end]
  for (const ev of events) {
    if (!ev.from || !ev.to) continue
    const f = new Date(ev.from).getTime()
    const t = new Date(ev.to).getTime()
    if (f > commence.getTime() && f < end.getTime()) bSet.add(f)
    if (t > commence.getTime() && t < end.getTime()) bSet.add(t)
  }

  // SHEX: insert a boundary at each midnight so Sundays are isolated
  if (terms === 'SHEX') {
    const d = new Date(commence)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + 1)           // first midnight after commence
    while (d.getTime() < end.getTime()) {
      if (d.getTime() > commence.getTime()) bSet.add(d.getTime())
      d.setDate(d.getDate() + 1)
    }
  }

  const sorted = [...bSet].sort((a, b) => a - b)
  const periods = []

  for (let i = 0; i < sorted.length - 1; i++) {
    const ps = new Date(sorted[i])
    const pe = new Date(sorted[i + 1])
    const hoursInPeriod = (pe - ps) / 3600000

    let label    = 'Laytime running'
    let excepted = false

    // Check events — first match wins
    for (const ev of events) {
      if (!ev.from || !ev.to) continue
      const ef = new Date(ev.from).getTime()
      const et = new Date(ev.to).getTime()
      if (ps.getTime() >= ef && pe.getTime() <= et) {
        label = ev.reason || (ev.isException ? 'Exception' : 'Event')
        if (ev.isException) excepted = true
        break
      }
    }

    // SHEX Sunday auto-exception (only if not already excepted by a manual event)
    if (!excepted && terms === 'SHEX' && ps.getDay() === 0) {
      excepted = true
      label    = 'Sunday exclusion'
    }

    periods.push({ label, from: ps, to: pe, hoursInPeriod, excepted })
  }

  return periods
}

// ─── App ─────────────────────────────────────────────────────────────────────

function newEvent() {
  return { id: crypto.randomUUID(), from: '', to: '', reason: '', isException: false }
}

export default function App() {
  const [apiKey,         setApiKey]         = useState(() => localStorage.getItem('layCalcApiKey') || '')
  const [vessel,         setVessel]         = useState('')
  const [voyageRef,      setVoyageRef]      = useState('')
  const [cargoQty,       setCargoQty]       = useState('')
  const [laytimeAllowed, setLaytimeAllowed] = useState('')
  const [demRate,        setDemRate]        = useState('')
  const [despRate,       setDespRate]       = useState('')
  const [norTime,        setNorTime]        = useState('')
  const [commenceTime,   setCommenceTime]   = useState('')
  const [endTime,        setEndTime]        = useState('')
  const [terms,          setTerms]          = useState('SHINC')
  const [events,         setEvents]         = useState([newEvent()])

  // ─── Inline calculation (runs every render) ───────────────────────────────

  const canCalc = commenceTime && endTime
  const commence = canCalc ? new Date(commenceTime) : null
  const end      = canCalc ? new Date(endTime)      : null
  const valid    = canCalc && end > commence

  let periods        = []
  let hoursUsed      = 0
  let allowed        = 0
  let balance        = 0
  let demurrageOwed  = 0
  let despatchEarned = 0
  let effectiveDespRate = 0

  if (valid) {
    periods           = buildPeriods(commence, end, events, terms)
    hoursUsed         = periods.reduce((s, p) => p.excepted ? s : s + p.hoursInPeriod, 0)
    allowed           = parseFloat(laytimeAllowed) || 0
    balance           = allowed - hoursUsed
    effectiveDespRate = parseFloat(despRate) || parseFloat(demRate) / 2 || 0

    if (balance < 0) {
      demurrageOwed  = Math.abs(balance) / 24 * (parseFloat(demRate) || 0)
    } else if (balance > 0) {
      despatchEarned = balance / 24 * effectiveDespRate
    }
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  const saveApiKey = val => { setApiKey(val); localStorage.setItem('layCalcApiKey', val) }

  const handleApply = data => {
    if (data.vessel       !== undefined) setVessel(data.vessel || '')
    if (data.voyageRef    !== undefined) setVoyageRef(data.voyageRef || '')
    if (data.cargoQty     !== undefined) setCargoQty(data.cargoQty != null ? String(data.cargoQty) : '')
    if (data.laytimeAllowed !== undefined) setLaytimeAllowed(data.laytimeAllowed != null ? String(data.laytimeAllowed) : '')
    if (data.demRate      !== undefined) setDemRate(data.demRate != null ? String(data.demRate) : '')
    if (data.despRate     !== undefined) setDespRate(data.despRate != null ? String(data.despRate) : '')
    if (data.norTime      !== undefined) setNorTime(data.norTime || '')
    if (data.commenceTime !== undefined) setCommenceTime(data.commenceTime || '')
    if (data.endTime      !== undefined) setEndTime(data.endTime || '')
    if (data.terms        !== undefined) setTerms(data.terms || 'SHINC')
    if (data.events?.length > 0) setEvents(data.events)
  }

  const addEvent    = () => setEvents(es => [...es, newEvent()])
  const removeEvent = id => setEvents(es => es.filter(e => e.id !== id))
  const updateEvent = (id, field, val) =>
    setEvents(es => es.map(e => e.id === id ? { ...e, [field]: val } : e))

  const despPlaceholder = demRate
    ? (parseFloat(demRate) / 2 || 0).toFixed(2) + ' (auto)'
    : 'Auto'

  return (
    <div>

      {/* ── NAV ─────────────────────────────────────────────────────────────── */}
      <nav className="nav">
        <div className="nav-brand">
          <div className="nav-icon">⚓</div>
          <div>
            <div className="nav-title">LayCalc</div>
            <div className="nav-sub">LAYTIME &amp; DEMURRAGE CALCULATOR</div>
          </div>
        </div>
        <button className="nav-print-btn" onClick={() => window.print()}>
          <span>🖨</span> Print / Export PDF
        </button>
      </nav>

      {/* ── BODY ─────────────────────────────────────────────────────────────── */}
      <div className="app-body">

        {/* Card 0 — AI document extraction */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">AI Document Extraction</div>
          </div>
          <div className="card-body">
            <div className="api-key-row">
              <label>Anthropic API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => saveApiKey(e.target.value)}
                placeholder="sk-ant-api03-…"
                autoComplete="off"
              />
              <span className="api-key-hint">Stored locally · never sent anywhere except api.anthropic.com</span>
            </div>
            <DocumentUploader apiKey={apiKey} onApply={handleApply} />
          </div>
        </div>

        {/* Card 1 — Voyage details */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Voyage details</div>
          </div>
          <div className="card-body">
            <div className="grid-3">
              <div className="field">
                <label>Vessel Name</label>
                <input type="text" value={vessel} onChange={e => setVessel(e.target.value)} placeholder="e.g. MV Atlantic Spirit" />
              </div>
              <div className="field">
                <label>Port / Voyage Reference</label>
                <input type="text" value={voyageRef} onChange={e => setVoyageRef(e.target.value)} placeholder="e.g. Rotterdam 2024-07" />
              </div>
              <div className="field">
                <label>Cargo Quantity (MT)</label>
                <input type="number" value={cargoQty} onChange={e => setCargoQty(e.target.value)} placeholder="0.000" min="0" />
              </div>
            </div>
          </div>
        </div>

        {/* Card 2 — Laytime parameters */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Laytime parameters</div>
          </div>
          <div className="card-body">
            <div className="grid-3">
              <div className="field">
                <label>Laytime Allowed (hrs)</label>
                <input type="number" value={laytimeAllowed} onChange={e => setLaytimeAllowed(e.target.value)} placeholder="0.00" min="0" step="0.5" />
              </div>
              <div className="field">
                <label>Demurrage Rate (USD/day)</label>
                <input type="number" value={demRate} onChange={e => setDemRate(e.target.value)} placeholder="0.00" min="0" />
              </div>
              <div className="field">
                <label>Despatch Rate (USD/day)</label>
                <input type="number" value={despRate} onChange={e => setDespRate(e.target.value)} placeholder={despPlaceholder} min="0" />
                <span className="helper">Auto: ½ × demurrage</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 3 — Dates & terms */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Dates &amp; terms</div>
          </div>
          <div className="card-body">
            <div className="grid-4">
              <div className="field">
                <label>NOR Tendered</label>
                <input type="datetime-local" value={norTime} onChange={e => setNorTime(e.target.value)} />
              </div>
              <div className="field">
                <label>Laytime Commenced</label>
                <input type="datetime-local" value={commenceTime} onChange={e => setCommenceTime(e.target.value)} />
              </div>
              <div className="field">
                <label>End of Operations</label>
                <input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} />
              </div>
              <div className="field">
                <label>Laytime Terms</label>
                <select value={terms} onChange={e => setTerms(e.target.value)}>
                  <option value="SHINC">SHINC</option>
                  <option value="SHEX">SHEX</option>
                  <option value="WIBON">WIBON</option>
                  <option value="WIPON">WIPON</option>
                </select>
                <span className="helper">{TERMS_HELP[terms]}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 4 — Time loss / exception events */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">Time loss / exception events</div>
            <button className="card-add-btn" onClick={addEvent}>+ Add event</button>
          </div>
          <div className="card-body">
            <div className="events-table">
              <div className="ev-head-row">
                <span>From</span>
                <span>To</span>
                <span>Reason</span>
                <span>Hours lost</span>
                <span>Exception</span>
                <span></span>
              </div>
              {events.map(ev => {
                const rawHrs = ev.from && ev.to
                  ? (new Date(ev.to) - new Date(ev.from)) / 3600000
                  : null
                const evHoursDisplay = rawHrs !== null && rawHrs >= 0
                  ? rawHrs.toFixed(2)
                  : '—'
                return (
                  <div key={ev.id} className="ev-row">
                    <input
                      type="datetime-local"
                      value={ev.from}
                      onChange={e => updateEvent(ev.id, 'from', e.target.value)}
                    />
                    <input
                      type="datetime-local"
                      value={ev.to}
                      onChange={e => updateEvent(ev.id, 'to', e.target.value)}
                    />
                    <input
                      type="text"
                      value={ev.reason}
                      onChange={e => updateEvent(ev.id, 'reason', e.target.value)}
                      placeholder="Reason…"
                    />
                    <div className="ev-hours">{evHoursDisplay}</div>
                    <label className="ev-exception">
                      <input
                        type="checkbox"
                        checked={ev.isException}
                        onChange={e => updateEvent(ev.id, 'isException', e.target.checked)}
                      />
                      Excepted
                    </label>
                    <button className="ev-delete" onClick={() => removeEvent(ev.id)}>×</button>
                  </div>
                )
              })}
            </div>
            <button className="add-event-btn" onClick={addEvent}>+ Add event</button>
          </div>
        </div>

        {/* ── RESULTS ─────────────────────────────────────────────────────────── */}
        {valid ? (
          <>
            <div className="divider" />

            {/* Summary cards */}
            <div className="summary-grid">
              <div className="stat-card">
                <div className="stat-label">Laytime allowed</div>
                <div className="stat-value">{fmtHrs(allowed)}</div>
                <div className="stat-unit">hours</div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Laytime used</div>
                <div className="stat-value">{fmtHrs(hoursUsed)}</div>
                <div className="stat-unit">hours</div>
              </div>

              <div className={`stat-card${balance < 0 ? ' debit' : balance > 0 ? ' credit' : ''}`}>
                <div className="stat-label">Balance</div>
                <div className="stat-value">
                  {balance < 0
                    ? `−${fmtHrs(Math.abs(balance))}`
                    : balance > 0
                      ? `+${fmtHrs(balance)}`
                      : '0.00'}
                </div>
                <div className="stat-unit">
                  {balance < 0
                    ? 'hrs on demurrage'
                    : balance > 0
                      ? 'hrs despatch'
                      : 'hours — breakeven'}
                </div>
              </div>

              <div className={`stat-card${balance < 0 ? ' debit' : balance > 0 ? ' credit' : ''}`}>
                <div className="stat-label">
                  {balance < 0 ? 'Demurrage owed' : 'Despatch earned'}
                </div>
                <div className="stat-value">
                  {balance < 0 ? fmtUSD(demurrageOwed) : fmtUSD(despatchEarned)}
                </div>
                <div className="stat-unit">USD</div>
              </div>
            </div>

            {/* Laytime statement */}
            <div className="stmt-card">
              <div className="stmt-head">
                <div className="card-title">Laytime statement</div>
                <div className="stmt-meta">
                  {[vessel, voyageRef, terms].filter(Boolean).join(' · ')}
                </div>
              </div>
              <table className="stmt-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Hrs counted</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p, i) => (
                    <tr key={i}>
                      <td>{p.label}</td>
                      <td>{fmt(p.from)}</td>
                      <td>{fmt(p.to)}</td>
                      <td>{p.excepted ? '—' : fmtHrs(p.hoursInPeriod)}</td>
                      <td>
                        {p.excepted
                          ? <span className="badge badge-exc">Excepted</span>
                          : <span className="badge badge-count">Counting</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total laytime used</td>
                    <td>{fmtHrs(hoursUsed)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <div className="empty-state">
            Enter laytime commencement and end of operations to see the calculation.
          </div>
        )}

      </div>
    </div>
  )
}
