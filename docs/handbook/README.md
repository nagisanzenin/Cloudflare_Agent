# Handbook

One card per topic. Each card has the same sections: default path, config, code, verify, gotchas, limits and cost, sources. Read only the cards your task needs.

Two tags matter everywhere: **COST** marks an action that can cost money, **DESTRUCTIVE** marks one that deletes or cannot be undone. [AGENTS.md](../../AGENTS.md) says what to do before either.

## Start here

| Card | Read when |
| --- | --- |
| [00-mental-model](00-mental-model.md) | You are new to Cloudflare, think in AWS/GCP terms, or must explain a term to a human |
| [01-choose-compute](01-choose-compute.md) | You must pick a product before writing config |

## Set up

| Card | Read when |
| --- | --- |
| [02-project-setup](02-project-setup.md) | Creating a project, adopting an existing one, writing `wrangler.jsonc`, local dev |
| [03-auth-and-tokens](03-auth-and-tokens.md) | A command needs an account, CI needs a token, the app needs a secret |
| [14-agent-tooling](14-agent-tooling.md) | Installing Cloudflare's Skills and MCP servers, fetching fresh docs, the `cf` CLI, the REST API |

## Build

| Card | Read when |
| --- | --- |
| [04-storage-overview](04-storage-overview.md) | Choosing a data store; using KV or R2 |
| [04b-d1](04b-d1.md) | SQL data, migrations, backup and restore |
| [04c-hyperdrive](04c-hyperdrive.md) | Connecting to a Postgres or MySQL you already have |
| [05-durable-objects](05-durable-objects.md) | Per-entity state, coordination, WebSockets, alarms |
| [06-workflows-queues-cron](06-workflows-queues-cron.md) | Work that outlives a request: multi-step jobs, queues, schedules |
| [07-containers-sandbox](07-containers-sandbox.md) | A real Linux environment, or running untrusted commands |
| [07b-dynamic-workers](07b-dynamic-workers.md) | Running code supplied at runtime inside an isolate |
| [11-ai-and-agents](11-ai-and-agents.md) | Calling models, stateful agents, MCP servers, vector search |
| [12-data-platform](12-data-platform.md) | Analytics tables (Basin) and event streams (K2) |

## Operate

| Card | Read when |
| --- | --- |
| [08-deploy-release-rollback](08-deploy-release-rollback.md) | Shipping, gradual rollouts, rollback, routes and domains, environments |
| [13-ci-cd](13-ci-cd.md) | Deploying on git push, previews per pull request |
| [09-observe-debug](09-observe-debug.md) | Logs, traces, grouped errors, error codes, a failing production |
| [10-cost-and-limits](10-cost-and-limits.md) | Every price and limit, what starts costing money, guardrails |

## Runbooks

Step-by-step procedures that tie the cards together: [setup](../runbooks/setup.md), [release](../runbooks/release.md), [incident](../runbooks/incident.md), [teardown](../runbooks/teardown.md).

## Keeping cards honest

- Every card states the date it was verified and lists its sources. Anything the author could not confirm carries an inline `UNVERIFIED:` marker.
- To refresh a card: fetch each source as Markdown (`<docs URL>/index.md`), correct the card, update the date, and record the result in [STATUS.md](../../STATUS.md).
- Code in the cards is checked by compiling it against the current Wrangler types; the templates are also run locally. [STATUS.md](../../STATUS.md) lists what was and was not checked.
