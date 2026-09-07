import type { Field, FieldType, FormSchema } from '../../src/lib/api'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const fail = (msg: string, status = 400) => json({ error: msg }, status)

/**
 * Pull the form id out of a user-supplied URL.
 *
 * This function fetches a URL that arrived from the client, so the host is
 * pinned here and nowhere else. The check is deliberately done on a parsed
 * `URL`'s `hostname` — substring matching would accept
 * `https://evil.test/?x=docs.google.com` — and the id is then used to *rebuild*
 * the target URL from a literal template, so nothing the client sent is ever
 * fetched verbatim.
 */
function formIdFrom(raw: string): { id: string } | { error: string } {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return { error: 'ไม่ใช่ URL ที่อ่านได้' }
  }

  if (u.protocol !== 'https:') return { error: 'ต้องเป็น https' }

  // ponytail: forms.gle short links are not followed — that would mean fetching
  // a redirect to a host we cannot vet in advance. Open the short link once in a
  // browser and paste the docs.google.com URL it lands on.
  if (u.hostname === 'forms.gle') {
    return { error: 'ลิงก์ย่อ forms.gle ใช้ไม่ได้ — เปิดหนึ่งครั้งแล้ว copy URL docs.google.com มาวางแทน' }
  }
  if (u.hostname !== 'docs.google.com') {
    return { error: 'รับเฉพาะลิงก์ docs.google.com' }
  }

  const pub = u.pathname.match(/^\/forms\/d\/e\/([\w-]+)\//)
  if (pub) return { id: pub[1] }

  // /forms/d/<id>/edit carries the *editor* id, which is a different id from the
  // published one and cannot be converted without the API. Say so plainly —
  // otherwise this looks like a parser bug.
  if (/^\/forms\/d\/[\w-]+\//.test(u.pathname)) {
    return { error: 'นี่คือลิงก์หน้าแก้ไขฟอร์ม — ต้องใช้ลิงก์สาธารณะที่ลงท้ายด้วย /viewform' }
  }

  return { error: 'หา form id ใน URL ไม่เจอ' }
}

/** Slice out `var FB_PUBLIC_LOAD_DATA_ = [...];` and parse it. */
function loadData(html: string): unknown[] | null {
  const at = html.indexOf('FB_PUBLIC_LOAD_DATA_')
  if (at < 0) return null
  const eq = html.indexOf('=', at)
  if (eq < 0) return null
  // The blob is emitted as the whole body of one inline <script>, so its
  // terminating `;` is the one immediately before that tag closes.
  const end = html.indexOf(';</script>', eq)
  if (end < 0) return null
  try {
    const parsed = JSON.parse(html.slice(eq + 1, end))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Google's own question type codes. Anything unlisted falls through to
// 'unknown', which the UI treats as free text — an unfamiliar future type
// degrades to editable rather than disappearing.
const TYPES: Record<number, FieldType> = {
  0: 'short',
  1: 'paragraph',
  2: 'radio',
  3: 'dropdown',
  4: 'checkbox',
  5: 'scale',
  7: 'grid',
  9: 'date',
  10: 'time',
  // Unverified: no live form on hand had an upload question. If 13 is wrong the
  // question falls through to 'unknown' and is offered as text, which Google
  // then ignores on the prefill — wrong, but harmless.
  13: 'file',
}

/**
 * Walk FB_PUBLIC_LOAD_DATA_.
 *
 * Layout: [1][8] title, [1][1] question blocks; within a block, [1] text,
 * [3] type code, [4] the *list* of answer slots — [n][0] entry id,
 * [n][1] choices, [n][2] required, [n][3] grid row label.
 */
function fieldsFrom(data: unknown[]): { title: string; fields: Field[] } {
  const root = (data[1] ?? []) as any[]
  const title = String(root[8] ?? data[3] ?? 'Untitled form')
  const blocks = (root[1] ?? []) as any[]
  const fields: Field[] = []

  for (const b of blocks) {
    const slots = b?.[4]
    // Section breaks, page breaks and title/description blocks live in this
    // same array with no answer slots at all. Filter on the slots being there
    // rather than on a type allowlist.
    if (!Array.isArray(slots) || slots.length === 0) continue

    const type = TYPES[b[3] as number] ?? 'unknown'
    const qTitle = String(b[1] ?? '').trim() || '(ไม่มีหัวข้อ)'

    slots.forEach((s: any, i: number) => {
      if (s?.[0] === undefined || s?.[0] === null) return

      const rawChoices = Array.isArray(s[1]) ? s[1] : []
      const labels = rawChoices.map((c: any) => String(c?.[0] ?? ''))
      // Each choice is [label, null, null, null, isOtherFlag] — index 4 confirmed
      // against a live form's payload, where ordinary choices all carry 0. The
      // "Other" slot rides along in the same list with a blank label, which is
      // why choices are filtered on `!== ''` below.
      const hasOther = rawChoices.some((c: any) => c?.[4] === 1)

      // A grid question repeats one title across many rows, so keep the row
      // label to tell them apart. `s[3][0]` as the row label is unverified — no
      // live grid form was available — hence the positional fallback, which
      // keeps the rows distinguishable even if the index is wrong.
      const rowLabel =
        slots.length > 1 ? String(s[3]?.[0] ?? '').trim() || `แถวที่ ${i + 1}` : undefined

      fields.push({
        entryId: String(s[0]),
        title: qTitle,
        rowLabel,
        type,
        required: s[2] === 1,
        choices: labels.filter((l: string) => l !== ''),
        hasOther,
      })
    })
  }

  return { title, fields }
}

export default async (req: Request) => {
  if (req.method !== 'POST') return fail('POST only', 405)

  let url: unknown
  try {
    url = (await req.json())?.url
  } catch {
    return fail('body ต้องเป็น JSON')
  }
  if (typeof url !== 'string' || !url) return fail('ต้องส่ง url มาด้วย')

  const parsed = formIdFrom(url)
  if ('error' in parsed) return fail(parsed.error)

  const target = `https://docs.google.com/forms/d/e/${parsed.id}/viewform`
  let res: Response
  try {
    res = await fetch(target, {
      // A sign-in-gated form redirects to accounts.google.com. Do not follow it
      // — treat the redirect itself as the answer.
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; prefill)' },
    })
  } catch (e) {
    return fail(`ดึงหน้าฟอร์มไม่สำเร็จ: ${(e as Error).message}`, 502)
  }

  if (res.status >= 300 && res.status < 400) {
    return fail('ฟอร์มนี้ต้อง sign in ก่อน — อ่าน schema แบบไม่ล็อกอินไม่ได้', 403)
  }
  if (!res.ok) return fail(`ฟอร์มตอบกลับ ${res.status}`, 502)

  const data = loadData(await res.text())
  if (!data) {
    return fail('หน้านี้ไม่มี schema ของฟอร์ม — อาจไม่ใช่ฟอร์มสาธารณะ หรือถูกปิดรับคำตอบแล้ว', 422)
  }

  const { title, fields } = fieldsFrom(data)
  if (fields.length === 0) return fail('อ่าน schema ได้ แต่ไม่พบคำถามที่กรอกได้', 422)

  return json({ formId: parsed.id, title, fields } satisfies FormSchema)
}
