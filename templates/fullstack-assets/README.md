# fullstack-assets

Static files plus an API in one Worker. Files in `public/` are served directly; only `/api/*` runs code. Unknown paths fall back to `index.html`, which suits a single-page app.

## Run locally (no Cloudflare account needed)

```bash
npm install
npx wrangler dev
```

```bash
curl localhost:8787/api/hello     # JSON from the Worker
curl localhost:8787/              # public/index.html
curl -i localhost:8787/any/route  # 200 with index.html (SPA fallback)
```

## Using a framework build

Point `assets.directory` in `wrangler.jsonc` at the build output (`dist`, `build/client`, ...) and run the framework's build before `wrangler deploy`.

## Before the first deploy

Nothing to create. Check and deploy: `npm run check && npx wrangler deploy`

Handbook cards: `02-project-setup.md`, `08-deploy-release-rollback.md`.
