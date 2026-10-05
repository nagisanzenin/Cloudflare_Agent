# Choose the compute

> **Use when:** a project or feature is starting and you must decide which Cloudflare product runs it, before writing any config.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

## Default path

Walk down this list and stop at the first row that fits. Each step down costs more, starts slower, or adds moving parts.

| The work is | Use | Template | Card |
| --- | --- | --- | --- |
| Static files or a single-page app, maybe with a small API | Worker with static assets | `templates/fullstack-assets` | [02](02-project-setup.md) |
| An HTTP API, server-side rendering, a webhook, a proxy in front of an LLM | Worker | `templates/worker-api` | [02](02-project-setup.md) |
| State that belongs to one thing: a room, a user, a document, a session, a rate limiter, anything with WebSockets | Durable Object | `templates/durable-object` | [05](05-durable-objects.md) |
| A few seconds of work after the response | `ctx.waitUntil()` in the Worker (up to 30 seconds) | | [10](10-cost-and-limits.md) |
| Work to hand off and retry, in batches | Queue | `templates/background-jobs` | [06](06-workflows-queues-cron.md) |
| Several steps that must each survive failure, sleep for hours or days, or wait for a person | Workflow | `templates/background-jobs` | [06](06-workflows-queues-cron.md) |
| Work on a schedule | Cron Trigger | `templates/background-jobs` | [06](06-workflows-queues-cron.md) |
| A native binary, another language runtime, more than 128 MB of memory, a writable disk | Container (Workers Paid only) | `templates/container` | [07](07-containers-sandbox.md) |
| Shell commands or a whole repo run for an agent, in isolation | Container with the `durable_object` policy, plus the Sandbox helpers | | [07](07-containers-sandbox.md) |
| JavaScript or Python that arrives at runtime and only needs methods you hand it | Dynamic Worker (Workers Paid only) | | [07b](07b-dynamic-workers.md) |
| Calling a model | `env.AI.run()` | | [11](11-ai-and-agents.md) |

For data, use the decision table in [04-storage-overview](04-storage-overview.md).

## Verify

You picked the right level when all of these are true:

- The workload fits the limits of the row you chose ([10-cost-and-limits](10-cost-and-limits.md)).
- Nothing in the design keeps state in a Worker's memory between requests.
- Nothing polls in a loop inside a request. Waiting is done by a Workflow `step.sleep`, a Durable Object alarm, a Queue delay or a Cron Trigger.

## Gotchas

Signals that the choice was wrong, and the move that fixes it:

| Symptom | Move to |
| --- | --- |
| Error `1102`, `exceededCpu` or `exceededMemory` | Raise `limits.cpu_ms` (Paid, up to 5 minutes), stream instead of buffering, or move the heavy part to a Container |
| A counter, lock or "read what I just wrote" kept in KV | Durable Object. KV is eventually consistent and allows one write per second per key |
| A new TCP database connection opened on every request | Hyperdrive ([04c](04c-hyperdrive.md)) |
| A global variable used as a cache of user state | Durable Object, KV or D1. Isolates are evicted without notice |
| A request handler that waits minutes for a third party | Workflow with `step.waitForEvent`, or a Queue |
| One Durable Object receiving all traffic | One object per entity. A single object is single-threaded, with a soft limit of 1,000 requests per second |
| A Container used for plain request handling | Worker. A Container starts in about a second and bills while it runs |
| Untrusted code loaded into a Dynamic Worker with network access left open | Set `globalOutbound: null` or an egress gateway. Egress is open by default |

Cloudflare is the wrong tool when the job needs any of these. Say so to the human instead of forcing a fit:

- A GPU you control, or model training. Containers have no GPU instance type.
- More than 4 vCPU, 12 GiB of memory or 20 GB of disk in one instance.
- A large managed Postgres run by the platform itself. D1 is SQLite with a 10 GB cap per database; Hyperdrive only connects to a database hosted elsewhere.
- Heavy batch processing held in memory.

## Limits and cost

The numbers that drive this decision. Full tables: [10-cost-and-limits](10-cost-and-limits.md).

| | Worker | Durable Object | Container |
| --- | --- | --- | --- |
| Plan | Free or Paid | Free or Paid | Paid only |
| Start time | milliseconds | milliseconds | about 0.65 s median (measured by Cloudflare, 2026-09-30) |
| Memory | 128 MB | 128 MB | 256 MiB to 12 GiB by instance type |
| CPU per request | 10 ms Free; 30 s default, up to 5 min Paid | 30 s default, up to 5 min | not capped per request |
| Billed for | requests and CPU time | requests, active duration, storage | provisioned memory and disk, active CPU, while running |
| Languages | JavaScript, TypeScript, Python, WebAssembly | same | anything that runs on linux/amd64 |

## Sources

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/storage-options/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/containers/platform/pricing/
- https://developers.cloudflare.com/containers/platform/limits/
- https://developers.cloudflare.com/dynamic-workers/usage/egress-control/
- https://blog.cloudflare.com/faster-agent-sandboxes/
