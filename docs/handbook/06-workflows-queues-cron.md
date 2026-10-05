# Workflows, Queues and Cron Triggers

> **Use when:** work must outlive one request: multi-step durable jobs with retries and sleeps (Workflows), buffered/batched background messages (Queues), or a fixed schedule (Cron Triggers).
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

Pick: per-step state, retries, `sleep` for days, or wait for a human/webhook -> **Workflow**. Need fan-out, batching, back-pressure, dead-lettering -> **Queue**. Need "run every N minutes" -> **Cron Trigger** (or `schedules` on a Workflow).

## Default path

Workflows (Free and Paid plans):

1. `npm create cloudflare@latest -- my-workflow` (Hello World -> Worker only -> TypeScript), or `npm create cloudflare@latest workflows-starter -- --template "cloudflare/workflows-starter"`.
2. Write a class extending `WorkflowEntrypoint` (Code), add the `workflows` binding (Config), run `npx wrangler types`.
3. `npx wrangler dev`, then `npx wrangler deploy` **COST**.
4. Trigger and inspect:
   ```sh
   npx wrangler workflows trigger my-workflow '{"name":"Ada"}' --id my-run-1   # COST: 1 invocation + steps
   npx wrangler workflows instances list my-workflow
   npx wrangler workflows instances describe my-workflow latest      # per-step output; ID or "latest"
   npx wrangler workflows instances send-event my-workflow <ID> --type approval --payload '{"ok":true}'
   npx wrangler workflows instances pause|resume|restart my-workflow <ID>
   npx wrangler workflows instances terminate my-workflow <ID>       # DESTRUCTIVE: stops the run
   npx wrangler workflows instances delete my-workflow <ID>          # DESTRUCTIVE: removes instance state
   npx wrangler workflows delete my-workflow                         # DESTRUCTIVE: also deletes its instances
   ```
   Add `--local` (and `--port`, default 8787) to target a running `wrangler dev` session; `--json` for machine output.

Queues (Free and Paid plans):

1. `npx wrangler queues create my-queue` (name: 1-63 chars, letters/numbers/dashes, cannot be renamed). Optional: `--delivery-delay-secs=300`.
2. Add `queues.producers` and `queues.consumers` (Config), add a `queue()` handler (Code), `npx wrangler deploy` **COST**.
3. Tune: `npx wrangler queues update my-queue --delivery-delay-secs 60 --message-retention-period-secs 3000`.
4. Pull consumer instead of a Worker (one line): `npx wrangler queues consumer http add my-queue`, then `POST https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/queues/$QUEUE_ID/messages/pull` with `{ "visibility_timeout_ms": 10000, "batch_size": 2 }` and acknowledge by `lease_id`.

Cron Triggers:

1. Add a `scheduled()` handler and `triggers.crons` (five-field cron, UTC), `npx wrangler deploy` **COST**.
2. Test locally: `npx wrangler dev`, then `curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=*+*+*+*+*"`.

## Config

```jsonc
{
	"$schema": "node_modules/wrangler/config-schema.json",
	"name": "my-worker",
	"main": "src/index.ts",
	"compatibility_date": "2026-10-05",
	"observability": { "enabled": true },
	"workflows": [
		{
			"name": "my-workflow",          // max 64 chars
			"binding": "MY_WORKFLOW",
			"class_name": "MyWorkflow"
			// optional: "schedules": ["0 * * * *"]  -> a new instance per cron match, no scheduled() handler needed
		}
	],
	"queues": {
		"producers": [{ "queue": "my-queue", "binding": "MY_QUEUE" }],
		"consumers": [
			{
				"queue": "my-queue",
				"max_batch_size": 10,        // default 10, max 100
				"max_batch_timeout": 5,      // seconds, default 5, max 60
				"max_retries": 3,            // default 3, max 100
				"dead_letter_queue": "my-queue-dlq" // auto-created if missing
				// optional: "max_concurrency": <n>  (unset = autoscale to the platform max of 250)
			}
		]
	},
	"triggers": { "crons": ["*/3 * * * *", "0 15 1 * *"] }
}
```

- Workflow-only alternative: declare `"exports": { "MyWorkflow": { "type": "workflow", "name": "my-workflow" } }` and call it through `ctx.exports`; accepts the same `limits`, `schedules`, `default_retention` as a binding. Other Workers bind with `script_name` + `class_name`.
- `default_retention` on the workflow entry shortens how long finished instance state is kept (cannot be combined with `script_name`).
- Raise CPU per step / per consumer invocation / per cron run: `"limits": { "cpu_ms": 300000 }` (max 5 min).
- Cron: `"crons": []` removes all triggers; omitting `triggers` leaves deployed triggers untouched. Per-environment: `env.<name>.triggers`.

## Code

```ts
import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";

type Params = { name?: string };
type Job = { url: string };

export class MyWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		const data = await step.do("fetch data", async () => {
			const res = await fetch("https://api.cloudflare.com/client/v4/ips");
			return await res.json<{ result: { ipv4_cidrs: string[] } }>();
		});
		await step.sleep("pause", "20 seconds"); // number of ms or a duration string; max 365 days
		await step.waitForEvent<{ ok: boolean }>("wait for approval", {
			type: "approval",
			timeout: "1 hour", // default 24 hours; throws on timeout
		});
		return await step.do(
			"process",
			{ retries: { limit: 3, delay: "5 seconds", backoff: "linear" }, timeout: "15 minutes" },
			async () => ({ name: event.payload.name ?? "World", count: data.result.ipv4_cidrs.length }),
		);
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const id = url.searchParams.get("instanceId");
		if (id) {
			const instance = await env.MY_WORKFLOW.get(id);
			if (url.pathname === "/approve") {
				await instance.sendEvent({ type: "approval", payload: { ok: true } });
			}
			return Response.json(await instance.status());
		}
		if (url.pathname === "/enqueue") {
			await env.MY_QUEUE.send({ url: request.url } satisfies Job, { delaySeconds: 0 });
			return new Response("queued");
		}
		const instance = await env.MY_WORKFLOW.create({ params: { name: "Ada" } }); // optional id: "..."
		return Response.json({ instanceId: instance.id });
	},
	async queue(batch, env, ctx): Promise<void> {
		for (const msg of batch.messages) {
			console.log("consumed", JSON.stringify(msg.body));
			msg.ack(); // per-message ack: not redelivered if a later message fails
			// on failure: msg.retry({ delaySeconds: 60 });
		}
	},
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		console.log("cron fired", controller.scheduledTime);
	},
} satisfies ExportedHandler<Env>;
```

Other verified API names: `step.sleepUntil(name, Date | ms)`, `NonRetryableError` (throw inside `step.do` to stop retries), `env.MY_WORKFLOW.createBatch([...])`, `instance.terminate({ rollback: true })`, rollback handlers via the last `step.do` argument `{ rollback, rollbackConfig }`, `env.MY_QUEUE.sendBatch(messages, { delaySeconds })`, `batch.ackAll()`, `batch.retryAll({ delaySeconds })`.

## Verify

- Workflow: `npx wrangler workflows instances describe my-workflow latest` shows each step with output and a terminal status; in code `await instance.status()`.
- Queue: `npx wrangler tail` on the consumer Worker shows `consumed ...` lines after a `send()`.
- Cron: `curl "http://localhost:8787/cdn-cgi/local/scheduled?format=json"` returns `{"outcome":"ok","noRetry":false}`. Add `&time=1745856238000` to override `controller.scheduledTime`. Deployed runs: dashboard -> Worker -> Settings -> Trigger Events (last 100) or Workers Logs.

## Gotchas

- Workflows: a step callback re-runs on retry, so keep steps idempotent; non-stream step results and event payloads max 1 MiB (return a `ReadableStream<Uint8Array>` or an R2 key for more). `step.sleep`/`sleepUntil` do not count toward the step limit. Workflows cannot be deployed to Workers for Platforms namespaces. Exceeding the instance creation rate returns HTTP 429.
- Workflows: only `running` instances count toward concurrency; `waiting` (sleep, retry wait, `waitForEvent`) instances do not, but may be `queued` when they wake under load.
- Workflows `schedules` needs a recent Wrangler; update Wrangler if the schema rejects the key.
- Queues: one consumer Worker per queue (a second one fails at deploy). Without a DLQ, messages that exhaust `max_retries` are deleted permanently. Messages in a DLQ with no consumer are deleted after 4 days. Queue names are immutable.
- Queues: if the handler throws without per-message `ack()`, the whole batch is retried. `ack()`/`retry()`: first call on a message wins and overrides `ackAll()`/`retryAll()`. `retry()` does not make the consumer autoscale down.
- Queues: exceeding throughput makes `send()`/`sendBatch()` throw `Too Many Requests`; a full backlog throws `Storage Limit Exceeded`.
- Cron: changes take up to 15 minutes to propagate. Weekdays are 1 = Sunday ... 7 = Saturday; prefer `MON`-`SUN`. If Wrangler manages the Worker, manage crons only in the config file.

## Limits and cost

| Workflows | Free | Paid |
| --- | --- | --- |
| CPU per step | 10 ms | 30 s default, up to 5 min |
| Steps per instance | 1,024 | 10,000 default, up to 25,000 |
| Concurrent running instances per account | 100 | 50,000 |
| Instance creation rate | 100 / s | 300 / s per account, 100 / s per workflow |
| Finished-state retention | 3 days | 30 days |
| Requests | 100,000 / day (shared with Workers) | 10 M / month, then $0.30 / M |
| CPU time | 10 ms / invocation | 30 M ms / month, then $0.02 / M ms |
| Steps (billed since 2026-08-10) | 3,000 / day | 500,000 / month, then $0.80 / 100,000 |
| Storage (billed since 2026-08-10) | 1 GB-month | 1 GB-month, then $0.20 / GB-month |

Also: queued instances 100,000 Free / 2,000,000 Paid; state per instance 100 MB / 1 GB; subrequests 50 / 10,000 (up to 10 M); max 10,000 retries per step; instance ID max 100 chars; billed step count excludes retries and rollback handlers. One paragraph of the limits page still says "10,000 concurrent"; its table says 50,000 (table used here).

| Queues | Free | Paid |
| --- | --- | --- |
| Operations (per 64 KB written, read or deleted) | 10,000 / day | 1 M / month, then $0.40 / M |
| Message retention | 24 h fixed | 4 days default, 60 s to 14 days |

Queues limits (both plans): 10,000 queues/account; message 128 KB; `sendBatch` 100 messages or 256 KB; 5,000 msg/s per queue; backlog 25 GB; 250 concurrent consumer invocations; consumer wall time 15 min, CPU 30 s default up to 5 min; `delaySeconds` max 24 h; pull `visibility_timeout` max 12 h. A delivered message normally costs 3 operations (write, read, delete); each retry adds a read. No egress charge.

| Cron Triggers | Free | Paid |
| --- | --- | --- |
| Triggers per account | 5 | 250 |
| CPU per run | 10 ms | 30 s (interval < 1 h), 15 min (interval >= 1 h) |

Wall time per scheduled invocation: 15 minutes (both plans).

## Sources

- https://developers.cloudflare.com/workflows/get-started/guide/index.md
- https://developers.cloudflare.com/workflows/build/workers-api/index.md
- https://developers.cloudflare.com/workflows/build/trigger-workflows/index.md
- https://developers.cloudflare.com/workflows/reference/wrangler-commands/index.md
- https://developers.cloudflare.com/workflows/reference/limits/index.md
- https://developers.cloudflare.com/workflows/reference/pricing/index.md
- https://developers.cloudflare.com/queues/get-started/index.md
- https://developers.cloudflare.com/queues/configuration/configure-queues/index.md
- https://developers.cloudflare.com/queues/configuration/batching-retries/index.md
- https://developers.cloudflare.com/queues/configuration/dead-letter-queues/index.md
- https://developers.cloudflare.com/queues/configuration/pull-consumers/index.md
- https://developers.cloudflare.com/queues/platform/limits/index.md
- https://developers.cloudflare.com/queues/platform/pricing/index.md
- https://developers.cloudflare.com/workers/configuration/cron-triggers/index.md
- https://developers.cloudflare.com/workers/platform/limits/index.md
