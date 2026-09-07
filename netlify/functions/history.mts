const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * Everything the Apps Script Web App is allowed to be asked to do. The proxy is
 * deliberately dumb about payload shape — the sheet's schema lives in Code.gs —
 * but it is not a fully generic relay, so the action names are pinned here.
 */
const ACTIONS = ['listPresets', 'savePreset', 'deletePreset', 'listHistory', 'logFill']

export default async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Validate the request before reporting on configuration, so an unknown
  // action says so instead of hiding behind a missing env var.
  let payload: any
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'body ต้องเป็น JSON' }, 400)
  }
  if (!ACTIONS.includes(payload?.action)) {
    return json({ error: `action ไม่รู้จัก: ${payload?.action}` }, 400)
  }

  const url = process.env.SHEET_API_URL
  const token = process.env.SHEET_API_TOKEN
  if (!url || !token) {
    return json({ error: 'ยังไม่ได้ตั้ง SHEET_API_URL / SHEET_API_TOKEN' }, 500)
  }

  let res: Response
  try {
    // The token goes in the body, not a header: an Apps Script Web App never
    // sees request headers — doPost(e) is handed only e.parameter and
    // e.postData — so an Authorization header arrives as nothing at all.
    res = await fetch(url, {
      method: 'POST',
      // Apps Script's own 302 to script.googleusercontent.com must be followed
      // or every call comes back as an empty redirect.
      redirect: 'follow',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, token }),
    })
  } catch (e) {
    return json({ error: `เรียก sheet ไม่สำเร็จ: ${(e as Error).message}` }, 502)
  }

  const text = await res.text()
  try {
    const body = JSON.parse(text)
    // Apps Script answers 200 even for its own errors, so the verdict is in the body.
    return json(body, body?.error ? 502 : 200)
  } catch {
    // An HTML body here means Apps Script threw, or the deployment is not
    // shared widely enough to be reached without a Google login.
    return json({ error: `sheet ตอบกลับไม่ใช่ JSON (${res.status}) — เช็ค deployment ว่าเปิดเป็น "Anyone"` }, 502)
  }
}
