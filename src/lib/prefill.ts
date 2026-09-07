import type { Answer, Answers, Field, FormSchema } from './api'

/** Google's own marker for "the Other choice is selected". */
export const OTHER = '__other_option__'

/**
 * Practical ceiling for the generated link. Google truncates well before any
 * hard browser limit, so warn rather than hand over a link that loses answers.
 */
export const URL_WARN_AT = 8000

const asList = (v: string | string[]) => (Array.isArray(v) ? v : [v])

const isBlank = (v: string | string[]) =>
  Array.isArray(v) ? v.length === 0 : v.trim() === ''

/** The public URL of a form, rebuilt from its id — the only thing a saved preset needs to find its form again. */
export const viewformUrl = (formId: string) =>
  `https://docs.google.com/forms/d/e/${formId}/viewform`

/** File upload questions cannot be prefilled at all — Google refuses, by design. */
export const prefillable = (f: Field) => f.type !== 'file'

function appendOne(p: URLSearchParams, f: Field, a: Answer) {
  const key = `entry.${f.entryId}`

  if (f.type === 'date') {
    // Split suffixes, which is the shape Google's own "get prefilled link" emits.
    const [y, m, d] = String(a.value).split('-')
    if (!y || !m || !d) return
    p.append(`${key}_year`, String(Number(y)))
    p.append(`${key}_month`, String(Number(m)))
    p.append(`${key}_day`, String(Number(d)))
    return
  }

  if (f.type === 'time') {
    const [h, min] = String(a.value).split(':')
    if (!h || !min) return
    p.append(`${key}_hour`, String(Number(h)))
    p.append(`${key}_minute`, String(Number(min)))
    return
  }

  // Everything else is "one or more plain values on the same key", and the
  // repeated-key form is exactly how a multi-select checkbox is prefilled.
  for (const v of asList(a.value)) {
    if (v === OTHER) {
      const text = a.other?.trim()
      if (!text) continue
      p.append(key, OTHER)
      p.append(`${key}.other_option_response`, text)
    } else if (v.trim() !== '') {
      p.append(key, v)
    }
  }
}

/**
 * Build the prefilled link.
 *
 * The core requirement lives in the two `continue`s below: a field the user
 * marked manual is simply absent from the query string, which is what makes it
 * arrive blank in the form. There is no separate mechanism for it.
 */
export function buildPrefillUrl(schema: FormSchema, answers: Answers): string {
  const p = new URLSearchParams({ usp: 'pp_url' })

  for (const f of schema.fields) {
    const a = answers[f.entryId]
    if (!a?.auto || !prefillable(f)) continue
    if (isBlank(a.value)) continue
    appendOne(p, f, a)
  }

  return `${viewformUrl(schema.formId)}?${p}`
}

/** The subset actually sent, for the history row — mirrors buildPrefillUrl's filtering. */
export function filledValues(schema: FormSchema, answers: Answers) {
  const out: Record<string, string | string[]> = {}
  for (const f of schema.fields) {
    const a = answers[f.entryId]
    if (!a?.auto || !prefillable(f) || isBlank(a.value)) continue
    const label = f.rowLabel ? `${f.title} — ${f.rowLabel}` : f.title
    const shown = asList(a.value).map((v) => (v === OTHER ? `อื่นๆ: ${a.other ?? ''}` : v))
    out[label] = Array.isArray(a.value) ? shown : shown[0]
  }
  return out
}

/** Every field starts manual — nothing is prefilled until the user says so. */
export function blankAnswers(schema: FormSchema): Answers {
  return Object.fromEntries(
    schema.fields.map((f) => [f.entryId, { auto: false, value: f.type === 'checkbox' ? [] : '' }]),
  )
}
