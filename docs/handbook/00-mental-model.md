# Mental model

> **Use when:** you are new to this repo, you were trained mostly on AWS/GCP patterns, or you have to explain a Cloudflare concept to a human.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

## Cloudflare in five sentences

1. Code runs in **Workers**: functions executed inside V8 isolates at every Cloudflare location. There is no region to pick and no server to size.
2. Everything else attaches to a Worker through a **binding**: a named entry in `wrangler.jsonc` that appears as an object on `env`. No connection strings, no IAM policies.
3. State lives in purpose-built stores: KV (cache-like key-value), D1 (SQLite), R2 (files), Durable Objects (one single-threaded object per ID with its own SQLite), Hyperdrive (a pooled connection to a Postgres or MySQL you already have).
4. Work that does not fit a request goes to Queues, Workflows or Cron Triggers. Work that does not fit an isolate (128 MB, no arbitrary binaries) goes to Containers.
5. One tool drives all of it: `wrangler` reads `wrangler.jsonc`, runs the real runtime on your machine, and deploys.

## What differs from AWS and GCP

These are the habits that produce wrong code on Cloudflare.

| You expect | On Cloudflare |
| --- | --- |
| Choose a region, add regions for latency | Workers run near the user everywhere. Only stateful resources have a location (a D1 primary, a Durable Object, your origin database). |
| An SDK client plus an IAM role per service | A binding in config, used as `env.DB`, `env.BUCKET`, `env.QUEUE`. |
| Billed for wall-clock duration | Workers bill CPU time. Awaiting `fetch`, a database or an LLM costs nothing. |
| Full Node.js with a writable disk and a long-lived process | Web-standard runtime plus a Node.js compatibility layer (on by default from compatibility date 2026-08-04). No persistent local disk, no background process after the response. |
| In-memory globals survive between requests | Isolates are created and evicted at any time. Keep state in a Durable Object, KV, D1 or R2. |
| A background thread or `setInterval` | `ctx.waitUntil()` for seconds, a Queue for decoupled work, a Workflow for multi-step jobs, a Durable Object alarm or Cron Trigger for schedules. |
| Open a database connection per request | Use Hyperdrive for Postgres/MySQL, or D1. Raw TCP connections per request exhaust the database. |
| Provisioned concurrency to avoid cold starts | Not needed for Workers. Containers do have a start time (median about 650 ms as of 2026-09-30). |
| Scale by choosing instance sizes | Workers scale on their own. Only Containers have instance types. |

## Glossary for humans who are new to cloud

Use these one-liners when you explain a step. Say them before the step, not after.

- **Cloud**: renting someone else's computers to run your code.
- **Server / VM**: a whole rented machine that stays on all day. You install and maintain everything.
- **Container**: your app packed in a box with everything it needs. The provider runs the box. Runs any language or program; takes about a second to start.
- **Function** (serverless function; AWS calls its product Lambda): you hand over one piece of code that runs when a request arrives. Nothing runs, and nothing is billed, while nobody calls it.
- **Worker**: Cloudflare's function. Lighter than a Lambda (closer to a browser tab than to a machine), so it starts in milliseconds and runs in every city. The trade: 128 MB of memory and mainly JavaScript, TypeScript or Python.
- **Dynamic Worker**: still a Worker, but created by your running app from code it just received (written by an AI, or uploaded by your customer) and run in a locked box. Not needed for an ordinary app.
- **Durable Object**: a tiny always-findable program with its own private database, one per thing you care about (a chat room, a user, a document).
- **Binding**: a named plug that connects your code to a database, a file bucket or a queue. You declare it once in the config file.
- **Deploy**: upload a new version of the code and send traffic to it.
- **Rollback**: send traffic back to the previous version. It does not undo data changes.
- **Environment**: a separate copy of the app (for example staging) so changes can be tried without touching real users.
- **Secret**: a password or API key the app needs. Stored encrypted by Cloudflare, never written in code or git.
- **Cold start**: the delay when a platform has to start your code before answering.
- **Egress**: data leaving the provider's network. Most clouds charge for it per GB; Workers and R2 do not.
- **Free vs Paid plan**: Workers Free allows 100,000 requests per day. Workers Paid starts at $5 per month and unlocks higher limits and products such as Containers.

## Sources

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/
- https://blog.cloudflare.com/faster-agent-sandboxes/
- https://developers.cloudflare.com/dynamic-workers/
