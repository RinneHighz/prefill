// The contract both halves agree on. The Netlify functions import these types
// too, so the shape can only drift in one place.

export type FieldType =
  | 'short'
  | 'paragraph'
  | 'radio'
  | 'dropdown'
  | 'checkbox'
  | 'scale'
  | 'grid'
  | 'date'
  | 'time'
  | 'file'
  | 'unknown'

/** One answerable slot. A grid question yields one Field per row. */
export type Field = {
  entryId: string
  title: string
  /** Set only for grid rows, where several Fields share one question title. */
  rowLabel?: string
  type: FieldType
  required: boolean
  /** Empty for the text-shaped types. Excludes the "Other" slot. */
  choices: string[]
  hasOther: boolean
}

export type FormSchema = {
  formId: string
  title: string
  fields: Field[]
}

/** What the user decided for one field. `auto: false` means "leave blank, I'll type it in the form". */
export type Answer = {
  auto: boolean
  /** string for most types; string[] for checkbox. 'YYYY-MM-DD' for date, 'HH:MM' for time. */
  value: string | string[]
  /** Free text for the "Other" choice, used when `value` is (or contains) OTHER. */
  other?: string
}

export type Answers = Record<string, Answer>

export type Preset = {
  name: string
  formId: string
  formTitle: string
  answers: Answers
  updated: string
}

export type HistoryRow = {
  at: string
  formId: string
  formTitle: string
  preset: string
  values: Record<string, string | string[]>
  url: string
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const body = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }))
  if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  return body as T
}

const post = <T>(path: string, payload: object) =>
  call<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

export const discoverForm = (url: string) => post<FormSchema>('/api/discover-form', { url })

// Everything sheet-shaped goes through one endpoint as {action, ...payload};
// the function is a dumb authenticated proxy and stays that way.
const sheet = <T>(action: string, payload: object = {}) =>
  post<T>('/api/history', { action, ...payload })

export const listPresets = () => sheet<{ rows: Preset[] }>('listPresets').then((r) => r.rows)
export const savePreset = (p: Omit<Preset, 'updated'>) => sheet<{ ok: true }>('savePreset', p)
export const deletePreset = (name: string) => sheet<{ ok: true }>('deletePreset', { name })
export const listHistory = () => sheet<{ rows: HistoryRow[] }>('listHistory').then((r) => r.rows)
export const logFill = (row: Omit<HistoryRow, 'at'>) => sheet<{ ok: true }>('logFill', row)
