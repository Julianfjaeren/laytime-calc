import { useState, useRef } from 'react'

const EXTRACTION_PROMPT = `Extract laytime calculation data from this document and return ONLY a JSON object with these exact fields (omit any field you cannot confidently determine):

{
  "vessel": "vessel name string",
  "voyageRef": "port or voyage reference string",
  "cargoQty": 12345.678,
  "laytimeAllowed": 72.5,
  "demRate": 15000,
  "despRate": 7500,
  "norTime": "2024-07-14T08:00",
  "commenceTime": "2024-07-14T14:00",
  "endTime": "2024-07-16T22:00",
  "terms": "SHINC",
  "events": [
    {
      "from": "2024-07-15T06:00",
      "to": "2024-07-15T10:00",
      "reason": "Rain – equipment breakdown",
      "isException": true
    }
  ]
}

Rules:
- All datetime fields must be in "YYYY-MM-DDTHH:mm" format (no seconds, no timezone)
- terms must be one of: SHINC, SHEX, WIBON, WIPON
- cargoQty, laytimeAllowed, demRate, despRate are numbers (not strings)
- events array: only include events with clear from/to datetimes
- isException true = time is excepted from laytime count
- Return ONLY valid JSON, no markdown fences, no explanation`

async function extractFromFile(file) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_KEY
  const toBase64 = buf =>
    btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''))

  const buffer = await file.arrayBuffer()
  const base64 = toBase64(buffer)

  let contentBlock
  if (file.type.startsWith('image/')) {
    contentBlock = { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } }
  } else if (file.type === 'application/pdf') {
    contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
  } else {
    contentBlock = { type: 'text', text: new TextDecoder().decode(buffer) }
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: EXTRACTION_PROMPT }] }],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `API error ${res.status}`)
  }

  const data = await res.json()
  const text = data.content?.[0]?.text || ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Claude returned no JSON — check the document type')
  return JSON.parse(match[0])
}

export default function DocumentUploader({ onApply }) {
  const [phase, setPhase] = useState('idle') // idle | loading | review | error
  const [edits, setEdits] = useState({})
  const [errorMsg, setErrorMsg] = useState('')
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)

  const handleFile = async file => {
    if (!file) return
    setFileName(file.name)
    setPhase('loading')
    setErrorMsg('')
    try {
      const data = await extractFromFile(file)
      setEdits(data)
      setPhase('review')
    } catch (e) {
      setErrorMsg(e.message || 'Extraction failed')
      setPhase('error')
    }
  }

  const handleDrop = e => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  const updateEdit = (field, val) => setEdits(prev => ({ ...prev, [field]: val }))

  const handleApply = () => {
    const events = (edits.events || []).map((ev, i) => ({
      id: Date.now() + i,
      from: ev.from || '',
      to: ev.to || '',
      reason: ev.reason || '',
      isException: !!ev.isException,
    }))
    onApply({ ...edits, events })
    setPhase('idle')
    setEdits({})
    setFileName('')
  }

  const reset = () => { setPhase('idle'); setEdits({}); setFileName(''); setErrorMsg('') }

  const TEXT_FIELDS = [
    ['vessel', 'Vessel Name'],
    ['voyageRef', 'Port / Voyage Ref'],
    ['cargoQty', 'Cargo Qty (MT)'],
    ['laytimeAllowed', 'Laytime Allowed (hrs)'],
    ['demRate', 'Demurrage Rate (USD/day)'],
    ['despRate', 'Despatch Rate (USD/day)'],
  ]
  const DATE_FIELDS = [
    ['norTime', 'NOR Tendered'],
    ['commenceTime', 'Laytime Commenced'],
    ['endTime', 'End of Operations'],
  ]

  return (
    <div className="uploader-wrap">
      {(phase === 'idle' || phase === 'error') && (
        <>
          <div
            className={`drop-zone${dragging ? ' drop-zone--over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
          >
            <div className="drop-icon">📄</div>
            <div className="drop-title">Drop a laytime document here</div>
            <div className="drop-sub">PDF · Image · Text · CSV — Claude extracts the data for you</div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv"
              style={{ display: 'none' }}
              onChange={e => handleFile(e.target.files[0])}
            />
          </div>
          {phase === 'error' && (
            <div className="uploader-status uploader-status--error">⚠ {errorMsg}</div>
          )}
        </>
      )}

      {phase === 'loading' && (
        <div className="uploader-status">
          <span className="spinner" />
          <span className="status-text">Extracting data from <em>{fileName}</em>…</span>
        </div>
      )}

      {phase === 'review' && (
        <div className="review-panel">
          <div className="review-header">
            <div className="review-title">Review extracted data</div>
            <div className="review-sub">from {fileName} — edit before applying</div>
          </div>

          <div className="review-fields">
            {TEXT_FIELDS.map(([field, label]) => edits[field] !== undefined && (
              <div key={field} className="review-field">
                <label>{label}</label>
                <input
                  type="text"
                  value={edits[field] ?? ''}
                  onChange={e => updateEdit(field, e.target.value)}
                />
              </div>
            ))}
            {DATE_FIELDS.map(([field, label]) => edits[field] !== undefined && (
              <div key={field} className="review-field">
                <label>{label}</label>
                <input
                  type="datetime-local"
                  value={edits[field] ?? ''}
                  onChange={e => updateEdit(field, e.target.value)}
                />
              </div>
            ))}
            {edits.terms !== undefined && (
              <div className="review-field">
                <label>Terms</label>
                <select value={edits.terms ?? 'SHINC'} onChange={e => updateEdit('terms', e.target.value)}>
                  <option value="SHINC">SHINC</option>
                  <option value="SHEX">SHEX</option>
                  <option value="WIBON">WIBON</option>
                  <option value="WIPON">WIPON</option>
                </select>
              </div>
            )}
          </div>

          {edits.events?.length > 0 && (
            <div className="review-events">
              <div className="review-section-label">Events ({edits.events.length} found)</div>
              {edits.events.map((ev, i) => (
                <div key={i} className="review-event-row">
                  <span className={`ev-badge${ev.isException ? ' ev-badge--exc' : ''}`}>
                    {ev.isException ? 'Excepted' : 'Event'}
                  </span>
                  <span className="ev-time">{ev.from} → {ev.to}</span>
                  <span className="ev-reason">{ev.reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="review-actions">
            <button className="outline-btn" onClick={reset}>Cancel</button>
            <button className="apply-btn" onClick={handleApply}>Apply to form →</button>
          </div>
        </div>
      )}
    </div>
  )
}
