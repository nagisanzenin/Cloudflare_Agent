# Cost and limits

> **Use when:** choosing a product, estimating a bill, hitting a limit error, or before any action that can move an account from Free to Paid.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

## Default path

1. Assume Workers Free unless the owner says the account is on Workers Paid. Never upgrade a plan or enable a paid-only product without explicit owner approval (**COST**).
2. Before deploying, check the product row in **Limits and cost** and confirm the workload fits the Free column.
3. Cap runaway CPU and fan-out in `wrangler.jsonc` (see **Config**).
4. Ask the owner to confirm a budget alert exists: dashboard > **Manage Account** > **Billing** > **Billable Usage** > **Budget alerts**.
5. Check current spend: the same **Billable Usage** page (Pay-as-you-go accounts only, needs Billing read permission), or the alpha API under **Guardrails**.
6. Check bundle size before deploy: `wrangler deploy --outdir bundled/ --dry-run` and read `Total Upload` (uncompressed; limit 64 MiB).

## Config

```jsonc
{
  "limits": {
    "cpu_ms": 30000,      // max CPU per invocation; default 30000, max 300000 (Workers Paid)
    "subrequests": 50     // default 50 Free / 10,000 Paid; max 50 Free / 10,000,000 Paid
  },
  "observability": {
    "enabled": true,
    "head_sampling_rate": 0.1   // log 10% of requests to cut log volume
  }
}
```

`limits` are only supported on the Standard usage model and are only enforced when deployed, not in local development. The dashboard equivalent is **Workers & Pages** > Worker > **Settings** > **CPU Limits**.

## Verify

- `wrangler deploy --outdir bundled/ --dry-run` prints `Total Upload: <size> / gzip: <size>`. Only the uncompressed value counts.
- Dashboard **Billable Usage** shows a daily cost chart and a per-product table (Total usage, Billable usage, Usage cost). Figures come from the same system as the invoice. Fixed-fee plan subscriptions are not included.
- D1 usage: the query `meta` object, the GraphQL Analytics API, or dashboard > D1 database > Metrics > Row Metrics.
- Workers AI usage: the Workers AI dashboard (Neurons).

## Gotchas

- Workers Paid is a minimum charge of $5 USD per month per account, separate from any zone plan (Free, Pro, Business).
- Free limits reset daily at 00:00 UTC. Paid included usage is monthly and resets on the subscription renewal date.
- On Free, exceeding a KV, Hyperdrive or Workers AI limit makes further operations of that type fail with an error. Exceeding the Workers daily request limit returns Error `1027` (or bypasses the Worker on fail-open routes).
- On Free with `run_worker_first`, requests over the request limit get `429` instead of falling back to static assets.
- Workers run before the Cloudflare cache, so a cached request still counts. With Workers Caching enabled, cache hits are billed as requests (no CPU time).
- Subrequests are not billed. Service binding calls add no request fee; CPU time of both Workers is billed.
- A WebSocket connection is one request (the `Upgrade`). For Durable Objects, incoming WebSocket messages are billed at a 20:1 ratio (100 messages = 5 requests).
- Durable Objects duration is billed for 128 MB of wall-clock time while the object is active and cannot hibernate. Calling `accept()` on a WebSocket bills duration for the whole connection; use the WebSocket Hibernation API. Billable usage is rounded up to the next billable unit.
- Durable Objects: `setAlarm()` is one row written; deletes count as rows written; stored data is billed until removed. To downgrade from Paid to Free, first delete all key-value backed Durable Object namespaces (**DESTRUCTIVE**).
- D1: an unindexed filter still reads (scans) every row; an index adds one extra row written per write on the indexed column. Read replicas do not cost extra.
- Queues: one operation per 64 KB written, read or deleted; a delivered message is normally 3 operations; each retry is another read.
- KV is billed per key; a bulk read is billed by the number of keys read.
- Containers: memory and disk are billed on the provisioned instance type, CPU on active usage, in 10ms increments while running. Containers also bill their Worker and Durable Object. Deleting a container image and then rolling back a Worker can break that older version (**DESTRUCTIVE**).
- Workflows: step and storage usage is not billed before the start date announced in the Workflows billing changelog (2026-07-07).
- Budget alerts are informational only. They do not pause or cap usage. Usage is processed once per day, so an alert fires the day after the threshold is reached.
- **COST** change on December 1, 2026: Workers Logs and Workers Traces move to Cloudflare Observability pricing (table below).

## Limits and cost

### Workers

| | Free | Paid (Standard) |
| --- | --- | --- |
| Plan fee | $0 | minimum $5 USD per month per account |
| Requests | 100,000 per day | 10 million included per month, +$0.30 per additional million |
| CPU time | 10 milliseconds per invocation | 30 million CPU milliseconds included per month, +$0.02 per additional million CPU milliseconds |
| Duration | No charge | No charge or limit |
| Egress / bandwidth | No charge | No charge |

| Limit | Free | Paid |
| --- | --- | --- |
| CPU time per HTTP request | 10 ms | 5 min (default: 30 seconds) |
| CPU time per Cron Trigger | 10 ms | 30 seconds (< 1 hour interval), 15 min (>= 1 hour interval) |
| Memory per isolate | 128 MB | 128 MB |
| Subrequests per invocation | 50 | 10,000 (up to 10M) |
| Subrequests to internal services | 1,000 | matches configured limit (default 10,000) |
| Simultaneous outgoing connections per request | 6 | 6 |
| Environment variables per Worker | 64 | 128 |
| Environment variable size | 5 KB | 5 KB |
| Worker size (uncompressed) | 64 MiB | 64 MiB |
| Worker startup time | 1 second | 1 second |
| Workers per account | 100 | 500 |
| Cron Triggers per account | 5 | 250 |
| Cache API calls per request | 50 | 1,000 |
| Cache API max object size | 512 MB | 512 MB |
| Log data per request | 256 KB | 256 KB |
| Routes per zone | 1,000 | 1,000 |
| Custom domains per zone | 100 | 100 |
| Wall time: Cron Trigger, Queue consumer, DO alarm | 15 min | 15 min |
| `waitUntil()` after response | up to 30 seconds | up to 30 seconds |

Request body size depends on the zone plan: Free 100 MB, Pro 100 MB, Business 200 MB, Enterprise up to 5 GB (self-serve). Over the limit returns `413`. URL size 16 KB; request and response headers 128 KB (total) each.

### Static Assets

| | Free | Paid |
| --- | --- | --- |
| Requests to static assets | free and unlimited | free and unlimited |
| Asset storage | no additional cost | no additional cost |
| Files per Worker version | 20,000 | 100,000 (Wrangler >= 4.34.0) |
| Individual file size | 25 MiB | 25 MiB |
| `_headers` rules | 100 | 100 |
| `_redirects` static / dynamic / total | 2,000 / 100 / 2,100 | 2,000 / 100 / 2,100 |

### Workers KV

| | Free | Paid |
| --- | --- | --- |
| Keys read | 100,000 / day | 10 million/month, + $0.50/million |
| Keys written | 1,000 / day | 1 million/month, + $5.00/million |
| Keys deleted | 1,000 / day | 1 million/month, + $5.00/million |
| List requests | 1,000 / day | 1 million/month, + $5.00/million |
| Stored data | 1 GB | 1 GB, + $0.50/ GB-month |

### D1

| | Free | Paid |
| --- | --- | --- |
| Rows read | 5 million / day | First 25 billion / month included + $0.001 / million rows |
| Rows written | 100,000 / day | First 50 million / month included + $1.00 / million rows |
| Storage | 5 GB (total) | First 5 GB included + $0.75 / GB-mo |

### R2

| | Free | Standard storage | Infrequent Access storage |
| --- | --- | --- | --- |
| Storage | 10 GB-month / month | $0.015 / GB-month | $0.01 / GB-month |
| Class A operations | 1 million requests / month | $4.50 / million requests | $9.00 / million requests |
| Class B operations | 10 million requests / month | $0.36 / million requests | $0.90 / million requests |
| Data retrieval (processing) | None | None | $0.01 / GB |
| Egress to Internet | Free | Free | Free |

### Durable Objects

Free: SQLite-backed classes only. Paid: SQLite-backed; the key-value backend only for accounts that already have a key-value-backed namespace.

| | Free | Paid |
| --- | --- | --- |
| Requests (HTTP, RPC sessions, WebSocket messages, alarms) | 100,000 / day | 1 million / month, + $0.15/million |
| Duration | 13,000 GB-s / day | 400,000 GB-s / month, + $12.50/million GB-s |
| SQLite rows read | 5 million / day | First 25 billion / month included + $0.001 / million rows |
| SQLite rows written | 100,000 / day | First 50 million / month included + $1.00 / million rows |
| SQL stored data | 5 GB (total) | 5 GB-month, + $0.20/ GB-month |

Key-value backend (Paid only): read request units 1 million, + $0.20/million; write request units 1 million, + $1.00/million; delete requests 1 million, + $1.00/million; stored data 1 GB, + $0.20/ GB-month. A request unit is 4 KB.

### Queues

| | Free | Paid |
| --- | --- | --- |
| Standard operations | 10,000 operations/day included | 1,000,000 operations/month included + $0.40/million operations |
| Message retention | 24 hours (non-configurable) | 4 days default, configurable up to 14 days |

Estimate: `((Number of Messages * 3) - 1,000,000) / 1,000,000 * $0.40`.

### Workflows

| | Free | Paid |
| --- | --- | --- |
| Requests | 100,000 per day (shared with Workers requests) | 10 million included per month + $0.30 per additional million |
| CPU time | 10 milliseconds of CPU time per invocation | 30 million CPU milliseconds included per month + $0.02 per additional million CPU milliseconds |
| Storage | 1 GB-month | 1 GB-month included + $0.20/ GB-month |
| Steps | 3,000 per day | 500,000 included per month + $0.80/ additional 100,000 per month |

Per-step wall time is unlimited; each step is subject to the configured CPU time limit.

### Containers (Workers Paid only; Free: N/A)

| | Included per month | Then |
| --- | --- | --- |
| Memory | 25 GiB-hours | $0.0000025 per additional GiB-second |
| CPU | 375 vCPU-minutes | $0.000020 per additional vCPU-second |
| Disk | 200 GB-hours | $0.00000007 per additional GB-second |

| Instance type | vCPU | Memory | Disk |
| --- | --- | --- | --- |
| lite | 1/16 | 256 MiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |

`dev` and `standard` are aliases for `lite` and `standard-1`. Custom instance types: 1 to 4 vCPU, max 12 GiB memory, max 20 GB disk, minimum 3 GiB memory per vCPU.

| Egress region | Price per GB | Included per month |
| --- | --- | --- |
| North America & Europe | $0.025 | 1 TB |
| Oceania, Korea, Taiwan | $0.05 | 500 GB |
| Everywhere Else | $0.04 | 500 GB |

Account limits: concurrent memory 6 TiB, concurrent vCPU 1,500, concurrent disk 30 TB, total image storage 50 GB, image size up to the instance disk.

### Workers AI

| | Free allocation | Pricing |
| --- | --- | --- |
| Workers Free | 10,000 Neurons per day | N/A - upgrade to Workers Paid |
| Workers Paid | 10,000 Neurons per day | $0.011 / 1,000 Neurons |

Some models require a paid billing method (Workers Paid or prepaid AI Gateway credits); the pricing page lists them.

### Hyperdrive

| | Free | Paid |
| --- | --- | --- |
| Database queries | 100,000 / day | Unlimited |

### Workers Builds

| | Free | Paid |
| --- | --- | --- |
| Build minutes | 3,000 per month | 6,000 per month (then, +$0.005 per minute) |
| Concurrent builds | 1 | 6 |
| Build timeout | 20 minutes | 20 minutes |
| CPU | 2 vCPU | 4 vCPU |
| Memory | 8 GB | 8 GB |
| Disk space | 20 GB | 20 GB |
| Deploy Hooks | 10/min per Worker, 100/min per account | same |

### Workers Logs and observability

| | Free | Paid |
| --- | --- | --- |
| Log events written (before December 1, 2026) | 200,000 per day | 20 million included per month, +$0.60 per additional million |
| Retention | 3 Days | 7 Days |
| Workers Logpush | not available | 10 million / month, +$0.05/million |
| From December 1, 2026: ingestion | 0.5 GB per day (ingestion stops at the limit) | 50 GB per billing cycle, then $0.25 per GB |
| From December 1, 2026: storage | seven-day retention included | 12 GB-month per billing cycle, then $0.10 per GB-month |

## What starts costing money

- **COST** Subscribing to Workers Paid: minimum $5 USD per month per account. Required for Containers, Workers Logpush, the Durable Objects key-value backend, CPU time above 10 ms, more than 100,000 requests per day, more than 10,000 Neurons per day, and the Workers AI models that require a paid billing method.
- **COST** On Workers Paid, every row above bills automatically once the included monthly amount is used. There is no documented hard cap.
- **COST** R2 beyond its free monthly amounts: storage, Class A and Class B operations, and Infrequent Access retrieval.
- **COST** Containers: charges start when a request reaches the container or it is started manually, and stop when the instance sleeps. Egress beyond the included allotment is billed per GB.
- **COST** Workers Builds beyond 6,000 build minutes per month on Paid.
- **COST** Logs and traces at full sampling on a busy Worker; from December 1, 2026 paid observability usage continues automatically after the allowance is exhausted.
- Usage-based charges are invoiced for the previous billing period, so a first invoice can cover a partial period.

## Guardrails

| Guardrail | What it does | Availability | How to turn it on |
| --- | --- | --- | --- |
| Budget alerts | One email when cumulative usage-based spend for the billing period crosses a dollar threshold. Account-wide. Resets each billing period. Does not pause or cap usage. Plan fees (for example the Workers Paid fee) are excluded. | Pay-as-you-go accounts only; not Enterprise contracts | **Manage Account** > **Billing** > **Billable Usage** > **Create budget alert**: name, threshold (USD), email recipients, **Save**. Also **Notifications** > **Add** > Budget Alert. |
| Default budget alert | Cloudflare creates a $10 account-level alert for eligible Pay-as-you-go accounts that have none (changelog 2026-06-15). | Pay-as-you-go | On by default; edit or delete under **Billable Usage** > **Budget alerts**. |
| Billable Usage dashboard | Daily cost chart and per-product table, filter by product family, previous periods. Also shown as a sidebar widget on the Workers & Pages, D1, R2, KV, Queues, Vectorize, Durable Objects and Containers overview pages. | Pay-as-you-go; needs Billing read permission | **Manage Account** > **Billing** > **Billable Usage** |
| Usage-based billing notifications | Email to the billing address when one product metric (bytes, requests, queries, minutes) exceeds a threshold. Informational only. | Professional plan or higher | **Notifications** > **Add** > **Billable Usage** |
| Billable Usage API (alpha) | `GET /accounts/{account_id}/billable-usage` (Version 1, Alpha; query `from`, `to` as ISO 8601 dates; no parameters = current billing period; the reference marks it deprecated in favour of `get_account_usage_v1`). `GET /accounts/{account_id}/billable-usage/info` returns the billing cycle anchor day. `GET /accounts/{account_id}/billable/usage` is Version 2, Alpha, Restricted. | Alpha | Call with an API token: `Authorization: Bearer <token>` against `https://api.cloudflare.com/client/v4`. |
| Per-Worker limits | `limits.cpu_ms` and `limits.subrequests` cap one invocation; documented as the defence against runaway bills and denial-of-wallet attacks. | Standard usage model | `wrangler.jsonc` or dashboard **Settings** > **CPU Limits** |
| Sampling | `head_sampling_rate` on logs and traces reduces ingestion and storage. | All plans | `wrangler.jsonc` |
| Free plan | Daily limits return errors instead of billing. | Default plan | Stay on Workers Free. |

- Spend limits: no spend cap or automatic shutoff is documented. Budget alerts are stated to be informational only.
- The Billable Usage API was announced in the Agents Week recap (Cloudflare blog, 2026-08-10) as a way to track usage and costs. No changelog entry was found; the endpoints above come from the API reference, which labels them Alpha. UNVERIFIED: the token permission they need.

## Sources

- https://developers.cloudflare.com/workers/platform/pricing/index.md
- https://developers.cloudflare.com/workers/platform/limits/index.md
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/index.md
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/index.md
- https://developers.cloudflare.com/observability/pricing/index.md
- https://developers.cloudflare.com/containers/platform/pricing/index.md
- https://developers.cloudflare.com/containers/platform/limits/index.md
- https://developers.cloudflare.com/workers-ai/platform/pricing/index.md
- https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/index.md
- https://developers.cloudflare.com/workers/wrangler/configuration/index.md (`limits`)
- https://developers.cloudflare.com/billing/manage/budget-alerts/index.md
- https://developers.cloudflare.com/billing/manage/billable-usage/index.md
- https://developers.cloudflare.com/billing/understand/usage-based-billing/index.md
- https://developers.cloudflare.com/changelog/post/2026-06-15-budget-alerts-default-on/ (read via https://developers.cloudflare.com/changelog/product/billing/index.md)
- Changelog entries of 2026-06-04 (Billable Usage sidebar) and 2026-04-13 (Billable Usage dashboard and budget alerts), in https://developers.cloudflare.com/changelog/rss/workers.xml
- https://developers.cloudflare.com/api/index.md and https://developers.cloudflare.com/api/resources/billing/subresources/usage/methods/paygo/index.md
- https://developers.cloudflare.com/fundamentals/api/how-to/make-api-calls/index.md
- https://blog.cloudflare.com/agents-week-review-august-2026/
