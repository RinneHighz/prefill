# prefill

A personal web tool that turns saved answer sets into **prefilled Google Form
links**, so the routine parts of a form arrive already filled and only the parts
worth thinking about are left blank. Every generated link is logged, so past
fills are searchable.

Single user, no accounts.

## How it works

1. Paste a Google Form URL. The app fetches the public `viewform` page
   server-side and reads the `FB_PUBLIC_LOAD_DATA_` blob embedded in it to
   recover every question — its title, type, choices, and `entry.<id>`.
2. Every question starts as **fill by hand**. Turn on `autofill` per question
   and give it a value. Save the set as a named preset.
3. Generating a link builds
   `…/viewform?usp=pp_url&entry.<id>=<value>…` and opens it. Review and submit
   inside Google Forms as usual.
4. The values actually sent are appended to a Google Sheet as history.

The core requirement — "this question I want to answer myself" — needs no
feature: a question left off `autofill` is simply absent from the query string,
so it arrives blank.

The app never submits a form. It only prefills; the submit button stays with the
human.

## Stack

- React 19 + TypeScript + Vite (static)
- Two Netlify Functions, for the only two things a browser cannot do: fetch a
  cross-origin page, and hold a secret
- Google Sheet as the datastore, reached through an Apps Script Web App —
  no service account, no OAuth client, no `googleapis` dependency

```
browser ──▶ /api/discover-form ──▶ docs.google.com/forms/…/viewform
        └─▶ /api/history       ──▶ Apps Script Web App ──▶ Google Sheet
```

## Develop

```sh
npm install
npm run dev
```

Plain `vite`. Locally, the two functions are served at `/api/*` by a small dev
middleware in [`vite.config.ts`](vite.config.ts) that hands them the same
`Request`/`Response` pair Netlify's runtime does — so no Netlify CLI is needed
just to work on the app. **This changes nothing about deployment:** the files in
`netlify/functions/` are Netlify Functions and it is Netlify that runs them in
production. See the `ponytail:` note in `vite.config.ts` for when the CLI is
worth reaching for again.

`npm run build` runs `tsc --noEmit` then `vite build`.

## Deploy (Netlify)

Git-based deploy, so every push ships:

1. Push this repo to GitHub (private is fine).
2. Netlify › **Add new site › Import an existing project**, pick the repo.
   [`netlify.toml`](netlify.toml) already declares everything — build command
   `npm run build`, publish `dist`, functions `netlify/functions`, and the
   `/api/*` rule — so the defaults Netlify offers need no editing.
3. **Site configuration › Environment variables**: add `SHEET_API_URL` and
   `SHEET_API_TOKEN` (same values as `.env`). Redeploy after adding them —
   Netlify does not re-run a build just because a variable changed.

The functions use the Netlify Functions v2 signature (a default-exported
handler taking a `Request`, returning a `Response`) and are `.mts`, which
Netlify bundles natively — no build step of their own.

## Configure

Two variables, obtained in completely different ways:

| Variable | Where it comes from |
|---|---|
| `SHEET_API_TOKEN` | **You invent it.** Any random string. It is a shared password between this app and your Apps Script — nothing issues it. |
| `SHEET_API_URL` | **Google gives it to you** when you deploy the Apps Script as a Web App. Ends in `/exec`. |

Generate a token:

```sh
openssl rand -hex 32
```

Both are read only inside `netlify/functions/`, never bundled into the client.
Without them the app still reads forms and builds links — only presets and
history fail, and they say so in their own banner rather than blocking anything.

### 1. The Sheet half

1. Create a spreadsheet (`sheets.new`). **Extensions › Apps Script**. Delete
   the stub `myFunction`, paste all of [`apps-script/Code.gs`](apps-script/Code.gs), save.
2. **Project Settings** (gear, left sidebar) **› Script properties › Add script
   property**: name `TOKEN`, value = the string you generated. This must match
   `SHEET_API_TOKEN` exactly or every call answers `bad token`.
3. **Deploy › New deployment**, pick type **Web app** (gear icon next to
   "Select type"). Execute as **Me**, who has access **Anyone**. Deploy.
4. Google will ask you to authorize, then warn **"Google hasn't verified this
   app"**. That is expected — the unverified app is your own script. Click
   **Advanced › Go to (project name) (unsafe)** to continue. Stopping here is
   the single most common place this setup stalls.
5. Copy the **Web app URL** (ends in `/exec`) → that is `SHEET_API_URL`.
   Open it in a browser: it should answer `{"ok":true,"service":"prefill sheet api"}`.

The `presets` and `history` tabs are created on first write — no manual setup.

**After any edit to `Code.gs`**, the live deployment does *not* update: go
**Deploy › Manage deployments › (pencil) › Version: New version › Deploy**. The
`/exec` URL stays the same. Forgetting this looks exactly like your edit having
no effect.

### 2. Local

```sh
cp .env.example .env
```

Fill in both values, then **restart `npm run dev`** — they are read when the
Vite config is evaluated, so a running server will not pick them up.

`.env` is gitignored.

### 3. Netlify

**Site configuration › Environment variables › Add a variable**, add the same
two. Then **trigger a redeploy** (Deploys › Trigger deploy › Deploy site) —
Netlify does not rebuild just because a variable changed, so the site keeps
serving the old build until you do.

## Known limits

- **Public forms only.** A form that requires Google sign-in cannot have its
  schema read unauthenticated; the app says so instead of half-working.
- **`forms.gle` short links are rejected** — open one once and paste the
  `docs.google.com` URL it lands on.
- **The `/edit` URL will not work.** A form's editor id differs from its
  published id and cannot be converted; paste the `/viewform` link.
- **File upload questions can never be prefilled** (Google's rule, not this
  app's) and are shown as permanently manual.
- **Anyone with the site URL can use it** and read the history. That is the
  accepted trade for a single-user tool with no login — so anything sensitive
  belongs in a *fill by hand* question, never in a preset.

## Verification status

Confirmed against a live public Google Form: schema discovery (titles, types,
`entry` ids, required flags, choice lists), and a generated link arriving at
Google with exactly the chosen answers prefilled and every other question blank.

Not yet exercised against a real form: **grid** questions (row labels are read
from an unverified array index, with a positional fallback), **date**/**time**
splitting, the **"Other"** free-text option, **file upload** detection, and the
whole **Sheet** path (presets and history), which needs a deployed Apps Script.
