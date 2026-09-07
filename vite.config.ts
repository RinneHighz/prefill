import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Serve `netlify/functions/*.mts` at `/api/*` during `vite dev`.
 *
 * ponytail: this exists instead of a `netlify dev` dependency. The CLI is a
 * ~200 MB dev dependency that crashed outright on the Node in use here, and all
 * it was needed for is adapting a Node request to the `Request`/`Response` pair
 * these functions already speak — which is the twenty lines below. The same
 * files are what Netlify runs in production; nothing is duplicated. If this ever
 * needs real Netlify semantics (blobs, edge functions, redirect emulation),
 * that is the point to reach for the CLI again.
 */
function devFunctions(): Plugin {
  return {
    name: 'dev-functions',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api', async (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
        if (!/^[\w-]+$/.test(name)) return next()

        try {
          const mod = await server.ssrLoadModule(`/netlify/functions/${name}.mts`)

          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)

          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers.set(k, v)
          }

          const out: Response = await mod.default(
            new Request(`http://localhost${req.originalUrl ?? '/'}`, {
              method: req.method,
              headers,
              body: chunks.length ? Buffer.concat(chunks) : undefined,
            }),
          )

          res.statusCode = out.status
          out.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await out.arrayBuffer()))
        } catch (e) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: `dev function ${name}: ${(e as Error).message}` }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // The functions read process.env, as they will on Netlify. Vite only exposes
  // VITE_-prefixed vars to the client, so load the rest for the server side.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), devFunctions()],
    build: { outDir: 'dist' },
  }
})
