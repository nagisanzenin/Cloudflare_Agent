# background-jobs

One Worker with the three ways to run work outside a request: a Workflow (durable multi-step job), a Queue (producer and consumer) and a Cron Trigger.

## Run locally (no Cloudflare account needed)

```bash
npm install
npx wrangler dev
```

```bash
curl -X POST localhost:8787/signup -H 'content-type: application/json' -d '{"email":"a@example.com"}'
# {"instanceId":"..."}  -> the workflow sleeps 10 seconds, then puts a job on the queue
curl localhost:8787/signup/<instanceId>                            # "status":"complete" after about 10 seconds
curl "localhost:8787/cdn-cgi/local/scheduled?cron=0+3+*+*+*"       # fires the cron handler
```

The `wrangler dev` output shows the `job ...` and `cron ...` log lines.

## Before the first deploy

These steps change a Cloudflare account. Follow `AGENTS.md` in the handbook repo before running them.

1. Create the queue: `npx wrangler queues create background-jobs` (the dead-letter queue is created on deploy if it is missing).
2. Check and deploy: `npm run check && npx wrangler deploy`

Queues and Workflows have their own usage pricing: see `10-cost-and-limits.md`.

Handbook card: `06-workflows-queues-cron.md`.
