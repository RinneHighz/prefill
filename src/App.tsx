import { useEffect, useState } from 'react'
import type { Answer, Answers, Field, FormSchema, HistoryRow, Preset } from './lib/api'
import * as api from './lib/api'
import { OTHER, URL_WARN_AT, blankAnswers, buildPrefillUrl, filledValues, prefillable } from './lib/prefill'

const TYPE_LABEL: Record<Field['type'], string> = {
  short: 'ข้อความสั้น',
  paragraph: 'ข้อความยาว',
  radio: 'ตัวเลือกเดียว',
  dropdown: 'dropdown',
  checkbox: 'เลือกได้หลายข้อ',
  scale: 'สเกล',
  grid: 'ตาราง',
  date: 'วันที่',
  time: 'เวลา',
  file: 'แนบไฟล์',
  unknown: 'ไม่รู้จัก',
}

function FieldEditor({ field, answer, onChange }: {
  field: Field
  answer: Answer
  onChange: (a: Answer) => void
}) {
  const set = (patch: Partial<Answer>) => onChange({ ...answer, ...patch })
  const value = answer.value

  if (!prefillable(field)) {
    return <p className="note">Google ไม่ยอมให้ prefill ข้อแนบไฟล์ — ต้องแนบเองในฟอร์มเสมอ</p>
  }

  if (!answer.auto) {
    return <p className="note">เว้นว่างไว้ — จะไปกรอกเองในฟอร์ม</p>
  }

  const choiceList = field.hasOther ? [...field.choices, OTHER] : field.choices
  const label = (c: string) => (c === OTHER ? 'อื่นๆ…' : c)

  const otherBox = (shown: boolean) =>
    shown ? (
      <input
        className="other"
        placeholder="ระบุ…"
        value={answer.other ?? ''}
        onChange={(e) => set({ other: e.target.value })}
      />
    ) : null

  switch (field.type) {
    case 'paragraph':
      return <textarea rows={3} value={value as string} onChange={(e) => set({ value: e.target.value })} />

    case 'date':
      return <input type="date" value={value as string} onChange={(e) => set({ value: e.target.value })} />

    case 'time':
      return <input type="time" value={value as string} onChange={(e) => set({ value: e.target.value })} />

    case 'checkbox': {
      const picked = (value as string[]) ?? []
      const toggle = (c: string) =>
        set({ value: picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c] })
      return (
        <>
          <div className="choices">
            {choiceList.map((c) => (
              <label key={c} className="choice">
                <input type="checkbox" checked={picked.includes(c)} onChange={() => toggle(c)} />
                {label(c)}
              </label>
            ))}
          </div>
          {otherBox(picked.includes(OTHER))}
        </>
      )
    }

    case 'radio':
    case 'dropdown':
    case 'scale':
    case 'grid':
      if (choiceList.length === 0) break
      return (
        <>
          <select value={value as string} onChange={(e) => set({ value: e.target.value })}>
            <option value="">— เลือก —</option>
            {choiceList.map((c) => (
              <option key={c} value={c}>{label(c)}</option>
            ))}
          </select>
          {otherBox(value === OTHER)}
        </>
      )
  }

  return <input value={value as string} onChange={(e) => set({ value: e.target.value })} />
}

export default function App() {
  const [tab, setTab] = useState<'form' | 'history'>('form')
  const [formUrl, setFormUrl] = useState('')
  const [schema, setSchema] = useState<FormSchema | null>(null)
  const [answers, setAnswers] = useState<Answers>({})
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetName, setPresetName] = useState('')
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sheetError, setSheetError] = useState('')
  const [lastUrl, setLastUrl] = useState('')

  // The sheet is optional to *browse* a form — discovery works without it — so
  // its failure is reported separately and never blocks the main flow.
  const refreshSheet = () =>
    Promise.all([api.listPresets(), api.listHistory()])
      .then(([p, h]) => { setPresets(p); setHistory(h); setSheetError('') })
      .catch((e: Error) => setSheetError(e.message))

  useEffect(() => { void refreshSheet() }, [])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const discover = () =>
    run(async () => {
      const s = await api.discoverForm(formUrl)
      setSchema(s)
      setAnswers(blankAnswers(s))
      setPresetName('')
      setLastUrl('')
    })

  /** Keep only the fields this form actually has, so a preset from another form degrades instead of breaking. */
  const applyPreset = (p: Preset) => {
    if (!schema) return
    const base = blankAnswers(schema)
    for (const f of schema.fields) {
      const saved = p.answers[f.entryId]
      if (saved) base[f.entryId] = saved
    }
    setAnswers(base)
    setPresetName(p.name)
  }

  const save = () =>
    run(async () => {
      if (!schema || !presetName.trim()) throw new Error('ตั้งชื่อ preset ก่อน')
      await api.savePreset({ name: presetName.trim(), formId: schema.formId, formTitle: schema.title, answers })
      await refreshSheet()
    })

  const remove = (name: string) =>
    run(async () => {
      await api.deletePreset(name)
      if (presetName === name) setPresetName('')
      await refreshSheet()
    })

  const generate = () =>
    run(async () => {
      if (!schema) return
      const url = buildPrefillUrl(schema, answers)
      setLastUrl(url)
      window.open(url, '_blank', 'noopener')
      // Opening the form is the point; a history write that fails must not look
      // like the link failed.
      try {
        await api.logFill({
          formId: schema.formId,
          formTitle: schema.title,
          preset: presetName,
          values: filledValues(schema, answers),
          url,
        })
        await refreshSheet()
      } catch (e) {
        setSheetError(`เปิดลิงก์แล้ว แต่บันทึกประวัติไม่ได้: ${(e as Error).message}`)
      }
    })

  const autoCount = schema
    ? schema.fields.filter((f) => answers[f.entryId]?.auto && prefillable(f)).length
    : 0
  const forThisForm = presets.filter((p) => !schema || p.formId === schema.formId)

  return (
    <main>
      <header>
        <h1>prefill</h1>
        <nav>
          <button className={tab === 'form' ? 'on' : ''} onClick={() => setTab('form')}>ฟอร์ม</button>
          <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>
            ประวัติ {history.length ? `(${history.length})` : ''}
          </button>
        </nav>
      </header>

      {sheetError && <p className="warn">Google Sheet: {sheetError}</p>}
      {error && <p className="err">{error}</p>}

      {tab === 'history' ? (
        <section>
          {history.length === 0 && <p className="note">ยังไม่มีประวัติ</p>}
          {history.map((h, i) => (
            <details key={i} className="card">
              <summary>
                <strong>{h.formTitle || h.formId}</strong>
                <span className="meta">{h.at.replace('T', ' ').slice(0, 16)}{h.preset && ` · ${h.preset}`}</span>
              </summary>
              <dl>
                {Object.entries(h.values).map(([k, v]) => (
                  <div key={k}><dt>{k}</dt><dd>{Array.isArray(v) ? v.join(', ') : v}</dd></div>
                ))}
              </dl>
              <a href={h.url} target="_blank" rel="noopener">เปิดลิงก์เดิมอีกครั้ง</a>
            </details>
          ))}
        </section>
      ) : (
        <section>
          <div className="row">
            <input
              placeholder="วางลิงก์ Google Form (…/viewform)"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && discover()}
            />
            <button onClick={discover} disabled={busy || !formUrl}>อ่านฟอร์ม</button>
          </div>

          {schema && (
            <>
              <h2>{schema.title}</h2>

              <div className="presets">
                {forThisForm.map((p) => (
                  <span key={p.name} className="pill">
                    <button onClick={() => applyPreset(p)}>{p.name}</button>
                    <button className="x" title="ลบ" onClick={() => remove(p.name)}>×</button>
                  </span>
                ))}
                <input
                  className="pname"
                  placeholder="ชื่อ preset"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <button onClick={save} disabled={busy || !presetName.trim()}>บันทึก preset</button>
              </div>

              {schema.fields.map((f) => {
                const a = answers[f.entryId]
                if (!a) return null
                return (
                  <div key={f.entryId} className="card">
                    <div className="qhead">
                      <label className="auto">
                        <input
                          type="checkbox"
                          checked={a.auto}
                          disabled={!prefillable(f)}
                          onChange={(e) => setAnswers({ ...answers, [f.entryId]: { ...a, auto: e.target.checked } })}
                        />
                        autofill
                      </label>
                      <div className="qtitle">
                        {f.title}
                        {f.rowLabel && <span className="row-label"> → {f.rowLabel}</span>}
                        {f.required && <span className="req">*</span>}
                        <span className="meta"> {TYPE_LABEL[f.type]} · entry.{f.entryId}</span>
                      </div>
                    </div>
                    <FieldEditor
                      field={f}
                      answer={a}
                      onChange={(next) => setAnswers({ ...answers, [f.entryId]: next })}
                    />
                  </div>
                )
              })}

              <div className="footer">
                <button className="go" onClick={generate} disabled={busy}>
                  สร้างลิงก์แล้วเปิดฟอร์ม
                </button>
                <span className="meta">
                  autofill {autoCount} / {schema.fields.length} ข้อ
                </span>
              </div>

              {lastUrl && (
                <>
                  {lastUrl.length > URL_WARN_AT && (
                    <p className="warn">
                      ลิงก์ยาว {lastUrl.length} ตัวอักษร — Google อาจตัดคำตอบท้ายๆ ทิ้ง
                      ลองย้ายข้อที่ตอบยาวไปกรอกเอง
                    </p>
                  )}
                  <p className="note">
                    ถ้าแท็บไม่เปิด (popup ถูกบล็อก) <a href={lastUrl} target="_blank" rel="noopener">กดที่นี่</a>
                  </p>
                </>
              )}
            </>
          )}
        </section>
      )}
    </main>
  )
}
