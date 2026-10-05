# Runbook: production is failing

Restore service first, find the cause second. Details and the error-code tables: [09-observe-debug](../handbook/09-observe-debug.md).

## 1. See what is live and what is breaking

```bash
npx wrangler deployments status
npx wrangler deployments list
npx wrangler tail <worker> --status error --format json
```

Read `exceptions` and `outcome` in the tail output. Note the time of the last deployment.

## 2. Decide: roll back or fix forward

Roll back when the errors started with the last deployment and that deployment did not change data shape or Durable Object `exports`:

```bash
npx wrangler rollback <previous-version-id> --message "rollback: <reason>"    # COST: live immediately
```

Tell the human before you run it, in one sentence: traffic returns to the previous code, data is not changed.

Do not roll back, and fix forward instead, when:

- The last release migrated data that the old code cannot read.
- The last release changed Durable Object `exports` (the rollback will be refused).
- The errors did not start with a deployment.

## 3. If it is not the code

| Sign | Likely cause | Check |
| --- | --- | --- |
| Error `1027` | Free plan daily request limit reached | Resets at 00:00 UTC. Upgrading is the human's decision (COST) |
| Error `1102`, `exceededCpu`, `exceededMemory` | A request exceeds CPU or the 128 MB memory limit | [01-choose-compute](../handbook/01-choose-compute.md), gotchas table |
| KV, D1 or Workers AI calls fail on a Free account | A daily Free limit was hit | [10-cost-and-limits](../handbook/10-cost-and-limits.md) |
| `overloaded` from a Durable Object or D1 | One object or database takes too much traffic | Shard per entity; add indexes |
| Database connection errors through Hyperdrive | Origin database down, firewall, or connection limit | [04c-hyperdrive](../handbook/04c-hyperdrive.md) |
| Other `11xx` codes, or many unrelated Workers failing | Platform incident | https://www.cloudflarestatus.com |

## 4. Reproduce and fix

```bash
npx wrangler dev
```

Reproduce the failing request locally, inspect it (press `e` for the Local Explorer), fix, then ship through the [release](release.md) runbook.

## 5. After

Report to the human: what users saw and for how long, the cause, what you changed, the version now live, and what would catch it earlier next time (a health probe in the release step, an Issues automation, a budget alert).
