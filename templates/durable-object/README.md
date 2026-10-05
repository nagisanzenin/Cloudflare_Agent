# durable-object

A Worker that routes each name to its own Durable Object. Every object keeps its state in a private SQLite database and exposes typed RPC methods.

## Run locally (no Cloudflare account needed)

```bash
npm install
npx wrangler dev
```

```bash
curl -X POST localhost:8787/counter/alice   # {"name":"alice","count":1}
curl -X POST localhost:8787/counter/alice   # {"name":"alice","count":2}
curl localhost:8787/counter/bob             # {"name":"bob","count":0}
```

## Before the first deploy

Nothing to create: the class declared in `exports` is provisioned by `npx wrangler deploy`.

After the first deploy, treat `exports` as live infrastructure. Marking a class `"state": "deleted"` permanently deletes every object's data, and a deploy that changes `exports` cannot be rolled back past.

Handbook card: `05-durable-objects.md`.
