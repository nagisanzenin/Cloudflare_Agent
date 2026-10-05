# Runbook: release

Ship a change to a Worker and be able to undo it. Every command that reaches the account is marked. Details: [08-deploy-release-rollback](../handbook/08-deploy-release-rollback.md).

## 1. Before

```bash
bash <path-to-this-repo>/scripts/preflight.sh .
npx wrangler deployments status          # note the current version ID: this is the rollback target
```

Tell the human what this release changes: code only, or also config, bindings, data schema, routes. Get approval for anything tagged COST or DESTRUCTIVE in the cards.

First deploy only: say which resources will be created. A binding without an ID is created by the deploy itself.

## 2. Data changes go first, and stay backward compatible

Rolling back code does not roll back data. So:

- Make schema changes additive (new table, new nullable column). The old code must keep working against the new schema.
- For D1, record a restore point, then migrate:

  ```bash
  npx wrangler d1 time-travel info <db>               # save the bookmark it prints
  npx wrangler d1 migrations list <db> --remote
  npx wrangler d1 migrations apply <db> --remote      # COST: touches production data
  ```

- A change to Durable Object `exports` must be deployed alone, with `wrangler deploy`. You cannot roll back past it.

## 3. Deploy

Simple release, all traffic at once:

```bash
npx wrangler deploy --strict --message "<what changed>" --tag "$(git rev-parse --short HEAD)"   # COST: live
```

Staged release, when a mistake would hurt:

```bash
npx wrangler versions upload --message "<what changed>" --tag "$(git rev-parse --short HEAD)"
npx wrangler versions deploy <new-id>@10% <current-id>@90% -y --message "canary"    # COST: live traffic
# watch errors (step 4), then:
npx wrangler versions deploy <new-id>@100% -y --message "promote"                   # COST
```

`versions upload` cannot be used when the release changes Durable Object `exports` or a container image.

## 4. Verify

```bash
npx wrangler deployments status
curl -fsS https://<host>/<health-path>
npx wrangler tail <worker> --status error --format json     # leave running for a few minutes
```

The release is good when the status shows the new version, the probe returns the expected body, and the tail stays quiet under real traffic.

## 5. Roll back

```bash
npx wrangler rollback <previous-version-id> --message "rollback: <reason>"    # COST: live immediately
```

Then repeat step 4. Remember what a rollback does not do:

- It does not restore data in D1, KV, R2 or Durable Objects.
- It is refused across a Durable Object lifecycle change, or if the old version used a resource that no longer exists.

## 6. Report

Tell the human: the version ID now live, the version ID to roll back to, anything created, anything that now costs money, and what you verified.
