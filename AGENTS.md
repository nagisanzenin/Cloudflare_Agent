# AGENTS.md

You are an AI coding agent. This repository tells you how to put a project on Cloudflare and keep it running: set up, deploy, observe, roll back, and control cost. Read this file fully before any Cloudflare work, then follow the routing table.

Verified on 2026-10-05 with Wrangler 4.147.0. State of verification: [STATUS.md](STATUS.md).

## 1. Rules that override everything else here

1. **Money.** Never run an action tagged **COST** without the human's approval for that action and a monthly dollar cap they stated. Cloudflare has no hard spend cap: budget alerts only send an email, a day late. Your discipline is the only limit. Upgrading to Workers Paid ($5 per month minimum) is the human's decision.
2. **Destruction.** Never run an action tagged **DESTRUCTIVE** until you have listed exactly what will be removed and the human has confirmed the names. This covers deleting a Worker, database, bucket, namespace or queue, `time-travel restore`, and removing or tombstoning a Durable Object class in `exports`.
3. **Production data.** `--remote` touches live data. Pass `--local` or `--remote` explicitly on every `d1`, `kv` and `r2 object` command; the defaults differ between commands and the docs contradict each other.
4. **Secrets.** Never print, log, commit or paste a token, password or connection string. Secrets go through `wrangler secret put` (value piped on stdin) or are typed by the human. Never put one in `vars`, `wrangler.jsonc` or a shell command that lands in history.
5. **Authentication belongs to the human.** `wrangler login` opens a browser: ask the human to run it, or to provide a scoped `CLOUDFLARE_API_TOKEN`. Never create, widen or read out a token yourself. `wrangler whoami --json` and `wrangler auth token` print account details and credentials: do not echo their output.
6. **Fresh facts beat this repo.** Cloudflare ships weekly. Before you rely on a limit, price, flag or beta feature, fetch the live page (any docs URL plus `/index.md`; page index at `https://developers.cloudflare.com/<product>/llms.txt`). If the docs disagree with a card, the docs win: tell the human the card is stale.
7. **Verify before you claim.** The order is local run, dry run, deploy, probe. "Deployed" means you requested the live URL and saw the expected response. Report failures with their output.
8. **Say it plainly first.** The human may be new to cloud. Before a first-time, COST or DESTRUCTIVE step, state in one sentence what it does and what it changes, using [00-mental-model.md](docs/handbook/00-mental-model.md).

## 2. Every session

1. Run the pre-flight in the project directory. It is read-only and costs nothing:

   ```bash
   bash <path-to-this-repo>/scripts/preflight.sh .
   ```

2. Read [docs/handbook/README.md](docs/handbook/README.md) and the cards it routes you to. Do not write Cloudflare config from memory.
3. Follow the runbook for the task. Stop and ask when a rule in section 1 applies.

## 3. Route the task

| Task | Read |
| --- | --- |
| Explain a concept, or you think in AWS/GCP terms | [00-mental-model](docs/handbook/00-mental-model.md) |
| Decide which product to use | [01-choose-compute](docs/handbook/01-choose-compute.md), [04-storage-overview](docs/handbook/04-storage-overview.md) |
| Put a new or existing project on Cloudflare | [runbooks/setup](docs/runbooks/setup.md) |
| Ship a change, split traffic, roll back | [runbooks/release](docs/runbooks/release.md) |
| Production is failing | [runbooks/incident](docs/runbooks/incident.md) |
| Remove a project and stop its charges | [runbooks/teardown](docs/runbooks/teardown.md) |
| Estimate or cap cost, or a limit error appeared | [10-cost-and-limits](docs/handbook/10-cost-and-limits.md) |
| Install Cloudflare's own Skills and MCP servers | [14-agent-tooling](docs/handbook/14-agent-tooling.md) |
| Start from working code | [templates/](templates/) |

## 4. Defaults when the human has not said otherwise

- Config file `wrangler.jsonc`, TypeScript, `compatibility_date` set to today, `"observability": { "enabled": true }`.
- Wrangler installed as a dev dependency of the project (needs Node.js 22 or later), run as `npx wrangler`.
- Start with a plain Worker on the Free plan. Move up only when a concrete limit forces it ([01-choose-compute](docs/handbook/01-choose-compute.md)).
- One Wrangler environment per stage (`--env staging`), each with its own resources. Bindings and `vars` are not inherited by environments.
- Release with `npx wrangler deploy --strict --message "<what changed>" --tag "<git sha>"` from a clean git tree.
- Stay on Wrangler. Do not run the beta `cf` CLI inside a project that has a Wrangler config: `cf dev`, `cf build` and `cf deploy` can rewrite `package.json` and ignore `wrangler.jsonc`.

## 5. Commands that never block on a prompt

| Goal | Command |
| --- | --- |
| Check login | `npx wrangler whoami --json >/dev/null` (exit code 1 when not authenticated) |
| New project | `npm create cloudflare@latest -- <dir> --type=hello-world --lang=ts --no-deploy --no-open` |
| Adopt an existing project | `npx wrangler setup --dry-run`, then `npx wrangler setup --yes` |
| Create a database or namespace and write its ID to the config | `npx wrangler d1 create <name> --binding DB --update-config`, `npx wrangler kv namespace create <NAME> --binding <NAME> --update-config` |
| Set a secret | `printf '%s' "$VALUE" \| npx wrangler secret put <NAME>` |
| Bundle without uploading | `npx wrangler deploy --dry-run --outdir dist` |
| Gradual rollout | `npx wrangler versions deploy <new>@10% <current>@90% -y` |
| Roll back | `npx wrangler rollback <version-id> --message "<reason>"` |

## 6. What changed in 2026 that older training gets wrong

- **Durable Objects** are declared in a top-level `exports` map; the `migrations` array is legacy and the two cannot be mixed. Get a stub with `env.NS.getByName("name")`.
- **Node.js compatibility** is on by default from `compatibility_date` 2026-08-04. No `nodejs_compat` flag is needed for it.
- **Resources can be created for you.** A KV, D1, R2 or Queues binding without an ID is created on `wrangler deploy` and the ID is written back. That makes a plain deploy a resource-creating action.
- **`observability.enabled` turns on logs only.** Traces need `observability.traces.enabled`; grouped errors need `observability.issues.enabled`.
- **Limits moved.** A Worker may be 64 MiB uncompressed on both plans; Paid allows 10,000 subrequests by default. Memory is still 128 MB.
- **Containers** have two scheduling policies. The `Container` class from `@cloudflare/containers` belongs to the default policy; the beta `durable_object` policy uses `ctx.container` directly. `@cloudflare/sandbox` 1.0 is a set of helpers: `getSandbox()` and `sandbox.exec("...")` are the legacy 0.x API.
- **D1** documents `run()` as the method that returns rows (`all()` remains an alias).
- **Wrangler's `kv key` and `r2 object` commands act on local storage by default.** Add `--remote` to touch the real resource.
- **Third-party models** are called through the same `env.AI.run()` binding, routed by an AI Gateway.
- **MCP servers on Workers** use `createMcpHandler`; `McpAgent` is deprecated.
- **Previews.** `wrangler preview` creates branch previews; "Preview URLs" of versions are now called Version URLs.
- **Testing.** The Vitest integration is `@cloudflare/vitest-plugin`.
- **Observability pricing** changes to a per-GB model on 2026-12-01.

## 7. Definition of done

A Cloudflare task is done when all of these hold:

- `scripts/preflight.sh` reports zero FAIL lines.
- The change ran locally under `npx wrangler dev` and you exercised it.
- After a deploy: `npx wrangler deployments status` shows the new version and a request to the live URL returned what you expected.
- The human knows the version ID to roll back to, what was created, and what now costs money.
- No secret entered git, the config, the logs or the conversation.
