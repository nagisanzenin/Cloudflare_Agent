# worker-api

HTTP API on a Worker with D1 (SQL) and KV (read cache).

## Run locally (no Cloudflare account needed)

```bash
npm install
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

```bash
curl -X POST localhost:8787/api/notes -H 'content-type: application/json' -d '{"body":"hello"}'
curl -i localhost:8787/api/notes   # x-cache: miss, then hit on the next call
```

## Before the first deploy

These steps change a Cloudflare account. Follow `AGENTS.md` in the handbook repo before running them.

1. Remove the `d1_databases` and `kv_namespaces` entries from `wrangler.jsonc`, then let Wrangler create the resources and write the entries back with their IDs:

   ```bash
   npx wrangler d1 create worker-api-db --binding DB --update-config
   npx wrangler kv namespace create CACHE --binding CACHE --update-config
   ```

   Add `"migrations_dir": "migrations"` back to the D1 entry if Wrangler did not keep it.

2. Apply the schema to the real database before any code reads it: `npx wrangler d1 migrations apply DB --remote`
3. Check and deploy: `npm run check && npx wrangler deploy`

Shortcut: a plain `npx wrangler deploy` also creates any resource that has no ID and writes the ID back. The API then fails until step 2 has run, so prefer the order above.

Handbook cards: `04-storage-overview.md`, `04b-d1.md`, `08-deploy-release-rollback.md`.
