# Observe and debug a Worker

> **Use when:** a deployed or local Worker errors, is slow, or you need logs, traces, or grouped errors before changing code.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

## Default path

1. Add the `observability` block from **Config** to `wrangler.jsonc`, then `npx wrangler deploy`. Workers Logs needs Wrangler >= 3.78.6; Issues needs Wrangler >= 4.134.0.
2. Live logs (not stored): `npx wrangler tail [WORKER]`. Flags:

   | Flag | Values | Effect |
   | --- | --- | --- |
   | `--format` | `json` \| `pretty` | Output format; pipe `json` to `jq` |
   | `--status` | `ok` \| `error` \| `canceled` | Filter by invocation status |
   | `--method` | string | Filter by HTTP method |
   | `--header` | string | Filter by HTTP header |
   | `--search` | string | Text match in `console.log` messages |
   | `--ip` | string, or `self` | Filter by client IP |
   | `--sampling-rate` | number | Percentage of requests to log |
   | `--version-id` | string | Filter by Worker version |

   ```sh
   npx wrangler tail my-worker --status error --format json | jq '.exceptions'
   ```
   Each event is one JSON object with `outcome`, `scriptName`, `exceptions`, `logs`, `eventTimestamp`, `event.request`.
3. Stored logs (Workers Logs): dashboard > **Workers & Pages** > your Worker > **Observability**. Useful filters: `$metadata.error EXISTS`, `$workers.outcome = "exception"`. Invocation logs have `$cloudflare.$metadata.type = "cf-worker-event"`. Log JSON objects (`console.log({user_id: 123})`), not strings, so fields are indexed.
4. Traces: set `observability.traces.enabled = true`. No SDK or code change; fetch calls, binding calls, RPC calls and handler calls are instrumented automatically. Add context with `import { tracing } from "cloudflare:workers"` and `tracing.getActiveSpan()?.setAttribute("user.id", userId)`.
5. Workers Issues (open beta, free during beta): set `observability.issues.enabled = true` and deploy. Issues groups uncaught exceptions, failed invocations, `5xx` responses and error-level logs per Worker, with no SDK. It does not require Workers Logs or tracing. Report a handled error with `console.error(error)`. Statuses: `Active`, `Resolved` (a newer occurrence reopens it), `Ignored`. Issues never resolve automatically.
6. Route issues to a coding agent: dashboard **Issues** > **Automations** > **Add automation** (also configurable with `cf`). Triggers: occurrence threshold (runs once when the count crosses it) or recurrence after inactivity. Destinations: coding agent (prebuilt: Claude Code = routine ID + authorization token; Cursor = automation webhook URL; Devin = authorization token + organization ID), generic webhook (HTTPS, with a secret or mTLS), chat, incident management. Each run is attempted up to three times.
7. Local debugging: `npx wrangler dev`, then press `e` for Local Explorer (`/cdn-cgi/local/explorer`; Wrangler >= 4.118.0 or Vite plugin >= 1.50.0) or `D` for Chrome DevTools (breakpoints, CPU and memory profiling). With the Vite plugin, open the printed debug URL (for example `http://localhost:5173/__debug`).
8. Local tracing for agents (changelog 2026-08-04): `wrangler dev` and `vite dev` capture OpenTelemetry traces and correlated console logs for every local invocation with no code change. Inside an AI agent session the dev server prints the Local Explorer API URL.
   ```sh
   curl http://localhost:8787/cdn-cgi/local/explorer/api        # OpenAPI spec
   # POST /cdn-cgi/local/explorer/api/local/observability/query  -- query traces and logs with SQL
   ```

### Production is failing: what to run first

1. `npx wrangler deployments status` (what is live) and `npx wrangler deployments list` (the 10 most recent deployments).
2. `npx wrangler tail <WORKER> --status error --format json` and read `exceptions`.
3. If a deploy caused it, roll back: `npx wrangler rollback [<VERSION_ID>] --message "<why>"`. With no ID it uses the version uploaded before the latest. The rollback immediately becomes the active deployment on all routes and domains. `--message` skips the interactive prompts.
4. Match the client-facing error code against the tables under **Gotchas**.
5. Open Workers Logs with `$metadata.error EXISTS`; open **Issues** for grouped occurrences, stack trace and the Worker version that produced them.
6. Reproduce locally with `npx wrangler dev`, inspect the trace in Local Explorer, fix, redeploy, keep tailing to confirm.
7. Platform fault suspected (other `11xx` codes): check https://www.cloudflarestatus.com.

## Config

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "upload_source_maps": true,          // readable stack traces
  "observability": {
    "enabled": true,                   // Workers Logs; defaults to true for new Workers
    "head_sampling_rate": 1,           // 0..1, default 1 (100%)
    "logs": {
      "enabled": true,
      "head_sampling_rate": 0.6,       // separate rate for logs
      "invocation_logs": false         // drop the per-invocation log, keep custom logs
    },
    "traces": {
      "enabled": true,
      "head_sampling_rate": 0.05       // 0..1, default 1; head-based
      // UNVERIFIED: placement of `persist: false` (export without storing in Cloudflare); see the OpenTelemetry export page
    },
    "issues": { "enabled": true }      // Wrangler >= 4.134.0
  },
  "limits": { "cpu_ms": 300000 }       // default 30000; max 300000 (Workers Paid)
}
```

Per environment: put the same block under `env.<name>.observability` and deploy with `npx wrangler deploy -e <name>`.

## Verify

- `npx wrangler tail <WORKER> --format pretty`, send one request: one event appears with `outcome: "ok"`.
- Dashboard > Worker > **Observability** shows the invocation log (`<Method> <URL>` for fetch).
- Issues: send production traffic that fails, then open the Issues page. Only traffic after enabling is processed; historical failures are not.
- Local: `curl http://localhost:8787/cdn-cgi/local/explorer/api` returns an OpenAPI spec while `wrangler dev` runs.

## Gotchas

- `observability.enabled = true` enables logs only. Tracing needs `observability.traces.enabled = true` (Cloudflare states this will change in the future with a new `compatibility_date`).
- If Issues was enabled in the dashboard but `observability.issues.enabled` is missing from the Wrangler file, the next `wrangler deploy` turns Issues off.
- `wrangler tail` enters sampling mode under high traffic and drops messages; add filters. It can take up to 60 seconds to leave sampling mode. A maximum of 10 clients (dashboard sessions plus `wrangler tail` calls) can view one Worker's logs.
- `console.log` inside WebSocket handlers is hidden in `wrangler tail` until the client closes the connection.
- Real-time logs are not available for zones on the Cloudflare China Network.
- An automation does not give the destination access to the account. Configure the Workers Observability MCP server separately (card 14). Issue data can include request metadata and logs; keep secrets out of logs and span attributes.
- Floating promises may be cancelled when the invocation completes. Send external logs with `ctx.waitUntil(promise)`.
- `ctx.passThroughOnException()` covers unhandled exceptions in Worker code, not errors from the origin `fetch()`.
- `cf` cannot stream live logs yet; use `npx wrangler tail <WORKER_NAME>`.

### Error pages returned to the client

| Code | Meaning | Documented fix |
| --- | --- | --- |
| `1101` | Worker threw a JavaScript exception | Read the exception in `wrangler tail` / Workers Logs, fix, redeploy. Message `The script will never generate a response`: resolve or reject the pending Promise, or close the server-side WebSocket. |
| `1102` | Exceeded CPU time or memory (`Worker exceeded resource limits`) | CPU: raise `limits.cpu_ms` (Paid, up to 300000), profile CPU with DevTools, offload work to Durable Objects or smaller chunks. Memory: stream bodies (`TransformStream`), keep large data in KV/R2/D1, use Zod >= 4.5.0, profile memory with DevTools. Outcome is `exceededCpu` or `exceededMemory`. |
| `1103` | Owner must contact Cloudflare Support | Contact support. |
| `1019` | Loop limit: a Worker cannot call itself or another Worker more than 16 times | None documented; the `CF-EW-Via` header shows invocations left. |
| `1021` | Worker requested a host it cannot access | None documented. |
| `1022` | Cloudflare failed to route the request to the Worker | None documented. |
| `1024` | Subrequest to a Cloudflare-owned IP address | None documented. |
| `1027` | Free plan daily request limit exceeded (100,000/day, resets at midnight UTC) | Resets at midnight UTC; Workers Paid has no daily limit (**COST**). Route mode decides behavior: fail open bypasses the Worker, fail closed returns the `1027` page. |
| `1042` | Fetch to another Worker on the same zone | Use the `global_fetch_strictly_public` compatibility flag. |
| `10162` | Module has an unsupported Content-Type | None documented. |

### Errors on upload or deploy

| Code | Meaning | Documented fix |
| --- | --- | --- |
| `10006` | Could not parse the Worker's code | None documented. |
| `10007` | Worker or workers.dev subdomain not found | None documented. |
| `10015` | Account is not entitled to use Workers | None documented. |
| `10016` | Invalid Worker name | None documented. |
| `10021` | Validation error when loading top-level scope. Includes `Script startup exceeded CPU time limit` (1s) and `Script startup exceeded memory limit` (128 MB) | Move work out of global scope into the handler or build time. Run `wrangler check startup` for a CPU profile. |
| `10026` | Could not parse request body | None documented. |
| `10027` | Worker exceeded the size limit (64 MiB uncompressed) | Check with `wrangler deploy --outdir bundled/ --dry-run`; remove dependencies, move data to KV/R2/D1/Static Assets, split with Service bindings. |
| `10035` | Multiple attempts to modify a resource at the same time | None documented. |
| `10037` | Account exceeded the number of Workers allowed (100 Free, 500 Paid) | For a higher limit use Workers for Platforms. |
| `10052` | Binding uploaded without a name | None documented. |
| `10054` | Environment variable or secret exceeds the size limit (5 KB) | None documented. |
| `10055` | Too many environment variables or secrets (64 Free, 128 Paid per Worker) | None documented. |
| `10056` | Binding not found | None documented. |
| `10068` | No registered event handlers | None documented. |
| `10069` | Event handlers unsupported by the runtime | None documented. |

### Runtime errors (visible in logs only)

| Message | Meaning | Documented fix |
| --- | --- | --- |
| `Network connection lost` | Connection failure | Catch the `fetch` or binding call and retry it. |
| `Memory limit would be exceeded before EOF` | Reading a stream or buffer would exceed 128 MB | Stream bodies with `TransformStream` or `node:stream` instead of buffering. |
| `daemonDown` | Temporary problem invoking the Worker | None documented. |
| `Illegal invocation: function called with incorrect this reference` | Destructured a runtime method such as `ctx.waitUntil` | Call `ctx.waitUntil(p)` directly or `.bind(ctx)`. |
| `Cannot perform I/O on behalf of a different request` | An I/O object (Request, Response, stream) was cached in global scope | Store only the data in global scope; use Durable Objects or KV for shared state. |

## Limits and cost

| Item | Workers Free | Workers Paid |
| --- | --- | --- |
| Workers Logs events | 200,000 per day | 20 million included per month, +$0.60 per additional million (**COST**) |
| Workers Logs retention | 3 Days | 7 Days |
| Max logs per account per day | 5 Billion (then 1% head sample for the rest of the day) | same |
| Log data per request | 256 KB (truncated beyond; `$cloudflare.truncated` = true) | same |
| Traces retention | seven days | seven days |
| Issues | free during open beta | free during open beta |
| Issues: automations per account | 50 | 50 |
| Issues: occurrence detail retention | seven days | seven days |
| Issues: completed automation-run history | 30 days | 30 days |

**COST** change on December 1, 2026: Workers Logs, Workers Traces, Containers logs and Issues move to Cloudflare Observability pricing. Free: 0.5 GB ingestion per day, seven-day retention, ingestion stops at the daily limit until 00:00 UTC. Paid: 50 GB ingestion and 12 GB-month storage per billing cycle, then $0.25 per GB ingested and $0.10 per GB-month; paid usage continues automatically past the allowance. Lower `head_sampling_rate` to reduce both.

## Sources

- https://developers.cloudflare.com/workers/observability/logs/workers-logs/index.md
- https://developers.cloudflare.com/workers/observability/logs/real-time-logs/index.md
- https://developers.cloudflare.com/workers/observability/traces/index.md
- https://developers.cloudflare.com/workers/observability/issues/index.md
- https://developers.cloudflare.com/workers/observability/issues/automations/index.md
- https://developers.cloudflare.com/workers/observability/issues/investigate/index.md
- https://developers.cloudflare.com/workers/observability/errors/index.md
- https://developers.cloudflare.com/workers/observability/dev-tools/index.md
- https://developers.cloudflare.com/workers/local-development/local-explorer/index.md
- https://developers.cloudflare.com/changelog/post/2026-08-04-local-tracing/ (read via https://developers.cloudflare.com/changelog/rss/workers.xml)
- https://developers.cloudflare.com/workers/wrangler/commands/workers/index.md (`tail`, `rollback`, `deployments`, `check startup`)
- https://developers.cloudflare.com/workers/wrangler/configuration/index.md (`observability`, `limits`, `upload_source_maps`)
- https://developers.cloudflare.com/workers/platform/limits/index.md
- https://developers.cloudflare.com/observability/pricing/index.md
- https://developers.cloudflare.com/cf/wrangler/index.md
