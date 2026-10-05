# Deploy, release and roll back

> **Use when:** you ship a Worker to production, stage a release, split traffic, roll back, change routes/domains, or delete a Worker.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

Model: every code or config change creates a **version**. A **deployment** says which one or two versions serve traffic. `wrangler deploy` does both at once; `versions upload` + `versions deploy` split them.

## Default path

### 1. Pre-flight (no upload)

```sh
npx wrangler whoami --json
npx wrangler types --check
npx wrangler deploy --dry-run --outdir dist     # bundle + checks only
```

### 2. Simple release: version + 100% deployment in one step

```sh
npx wrangler deploy --strict --message "<what changed>" --tag "<git sha>"   # **COST** publishes live
npx wrangler deploy --env staging --strict                                  # **COST** deploys Worker `<name>-staging`
```

Useful flags (all current): `--env`, `--dry-run`, `--outdir`, `--minify`, `--keep-vars`, `--secrets-file <file>`, `--var key:value`, `--define key:value`, `--route`, `--domain`, `--triggers`, `--metafile`, `--tag`, `--message`, `--strict`, `--name`.

- `--strict` blocks the deploy when it could override remote settings in a non-interactive session. Use it from agents and CI.
- With no Wrangler config, `wrangler deploy` runs auto-config first (see `02-project-setup.md`). The docs give `--yes` to skip its prompts; `wrangler deploy --help` on 4.147.0 lists `--autoconfig` but not `--yes`. Prefer `wrangler setup --yes`, then deploy.
- `--temporary` deploys to a temporary account when no credentials exist (see `03-auth-and-tokens.md`). Documented, but not listed by `wrangler deploy --help` on 4.147.0.

### 3. Staged release: upload, test, then shift traffic

```sh
# a. Upload without serving traffic. Prints the version ID and a Version URL.
npx wrangler versions upload --message "<what changed>" --tag "<git sha>" --preview-alias staging

# b. List versions (10 most recent) and find IDs
npx wrangler versions list --json
npx wrangler versions view <VERSION_ID> --json

# c. Gradual deployment, non-interactive: new at 10%, current at 90%
npx wrangler versions deploy <NEW_VERSION_ID>@10% <CURRENT_VERSION_ID>@90% -y --message "canary 10%"   # **COST** live traffic

# d. Watch errors, then promote to 100%
npx wrangler versions deploy <NEW_VERSION_ID>@100% -y --message "promote"                               # **COST**
```

- `versions deploy` without version specs and `-y` is an interactive prompt: always pass both.
- Alternatives to positional specs: `--version-id`, `--percentage`, `--version-tag <tag>@<pct>`; `--dry-run` deploys nothing.
- Routes, domains and cron triggers are not applied by `versions upload`. Apply them with `npx wrangler triggers deploy` (experimental) or a full `npx wrangler deploy`.
- Secrets during a gradual rollout: `npx wrangler versions secret put|delete|bulk`, then `versions deploy`.

### 4. Inspect

```sh
npx wrangler deployments status --json   # what serves production now
npx wrangler deployments list --json     # 10 most recent deployments
```

### 5. Roll back

```sh
npx wrangler rollback <VERSION_ID> --message "rollback: <reason>"   # **COST** immediately live on all routes and domains
```

- Passing `--message` (empty string allowed) skips the confirmation and message prompts. Always pass it.
- Without `VERSION_ID` it targets the version uploaded before the latest one. Pass the ID explicitly.
- From a split deployment, rollback replaces both versions with the chosen one at 100%.
- Other target: `--name <worker>`.

### 6. Branch previews

`npx wrangler preview` (Wrangler >= 4.135.0) creates or updates a Preview named after the current git branch; `--name`, `--json`, `--env` are available. Details and CI usage: `13-ci-cd.md`.

### 7. Delete a Worker

```sh
npx wrangler delete --dry-run                 # show what would be deleted
npx wrangler delete --name <worker>           # **DESTRUCTIVE** deletes the Worker and its associated developer platform resources
npx wrangler delete --env staging             # **DESTRUCTIVE** deletes `<name>-staging`
npx wrangler preview delete --name <preview> --skip-confirmation   # **DESTRUCTIVE**
```

UNVERIFIED: no documented flag skips the `wrangler delete` confirmation. `--force` (per `wrangler delete --help` on 4.147.0) means "delete even if doing so will break other Workers that depend on this one"; it is not a confirmation skip. Expect a prompt and hand the command to a human if it blocks.

## Config

Routes, custom domains, workers.dev and Version URLs:

```jsonc
{
  "name": "my-worker",
  "routes": [
    { "pattern": "shop.example.com", "custom_domain": true },              // Custom Domain: DNS + cert managed for you
    { "pattern": "example.com/api/*", "zone_name": "example.com" },        // zone name route
    { "pattern": "sub.example.com/*", "zone_id": "<YOUR_ZONE_ID>" }        // zone ID route
  ],
  // "route": "example.com/*",   // simple form; use `route` or `routes`, not both
  "workers_dev": false,          // default: true with no routes, false once routes exist
  "preview_urls": false          // Version URLs; if omitted Wrangler leaves the existing setting alone
}
```

Environments: each is deployed as a separate Worker named `<name>-<env>`.

```jsonc
{
  "name": "my-worker",
  "route": "dev.example.com/*",
  "vars": { "ENVIRONMENT": "dev" },
  "kv_namespaces": [{ "binding": "CACHE", "id": "<KV_ID_DEV>" }],
  "env": {
    "staging": {
      "workers_dev": true,                       // https://my-worker-staging.<subdomain>.workers.dev
      "vars": { "ENVIRONMENT": "staging" },
      "kv_namespaces": [{ "binding": "CACHE", "id": "<KV_ID_STAGING>" }]
    },
    "production": {
      "routes": ["example.com/foo/*", "example.com/bar/*"],
      "vars": { "ENVIRONMENT": "production" },
      "kv_namespaces": [{ "binding": "CACHE", "id": "<KV_ID_PRODUCTION>" }]
    }
  }
}
```

- Select with `--env <name>` / `-e`, or `CLOUDFLARE_ENV=<name>` (the flag wins). With the Vite plugin use `CLOUDFLARE_ENV` at build time.
- Inherited: most keys (`main`, `compatibility_date`, `assets`, `observability`, routes...). **Not inherited**, restate per env: `vars`, `define`, every binding (`kv_namespaces`, `r2_buckets`, `d1_databases`, `durable_objects`, `services`, `queues`, ...), `secrets`, `secrets_store_secrets`.
- Top-level only: `keep_vars`, `send_metrics`, `site`.
- A service binding to a Worker in an environment must name it `<worker>-<env>`.
- Secrets are per environment: `npx wrangler secret put KEY --env production`.

## Verify

- After deploy: the command prints the Worker name, version ID and URLs. Confirm with `npx wrangler deployments status --json` and `curl -fsS https://<host>/<health path>`.
- Machine-readable results: set `WRANGLER_OUTPUT_FILE_PATH=out.ndjson`; Wrangler appends ND-JSON entries of type `deploy`, `version-upload`, `version-deploy`, `command-failed`.
- Split check: request the Worker about 10 times and compare responses, or read the version with the Version metadata binding.
- Version URL: `<version-prefix>-<worker-name>.<subdomain>.workers.dev`; alias: `<alias>-<worker-name>.<subdomain>.workers.dev`.

## Gotchas

- **Durable Object lifecycle changes** (declarative `exports`, or the legacy `migrations` array) cannot go through `versions upload`: such versions are rejected. Ship them with `npx wrangler deploy`, alone, separate from other code changes. **DESTRUCTIVE**: after a lifecycle change is deployed you cannot roll back to any version before it.
- Gradual deployments with Durable Objects: only one version of each object runs at a time; each object is assigned a version by the configured percentages and resets when its version changes. Keep the Worker and Durable Object APIs forward and backward compatible. `versions deploy --durable-objects-code-update-mode` takes `immediate`, or `deferred` followed by a maximum delay (docs example: `deferred 30s`).
- Rollback is refused if a Durable Object lifecycle change happened in between, or if the target version binds an R2 bucket, KV namespace or queue that no longer exists.
- Rollback does not touch bound resources: KV, R2, D1 and Durable Object data are not versioned. Old code can break on a changed data shape.
- Version skew: by default every request is routed independently, so one user can hit both versions. Use version affinity to pin users and version overrides to pin a service-binding callee.
- Version URLs are public when enabled, and are not generated for Workers that implement a Durable Object (including Containers and Sandbox). No Workers Logs, `wrangler tail` or Logpush for Version URLs. Aliases can only be created at upload time.
- Version URLs default to the `workers_dev` setting. Disabling the `workers.dev` route on an existing Worker does not disable Version URLs, Preview URLs or Deployment URLs; set `preview_urls` explicitly.
- `workers.dev` is re-enabled on the next deploy if it was disabled only in the dashboard and the config has neither `workers_dev: false` nor routes.
- Wrangler config is the source of truth: a deploy overwrites dashboard-edited vars (unless `--keep-vars` / `keep_vars`) and routes. A deploy never deletes secrets.
- `secret put` / `secret delete` create a version and deploy it immediately.
- `versions upload` does not update Container images; use `wrangler deploy` for Workers with Containers.
- Custom Domains: not on a hostname that already has a CNAME record, not on a zone you do not own, no wildcard records. Deleting one leaves its Advanced Certificate behind.
- Environment names end up in public certificates; do not put sensitive words in them.
- Positional `wrangler deploy <assets-dir>` works only in interactive mode; set `assets.directory` or pass `--assets`.
- Token needs: Editor on the Worker; plus Workers Routes Write per zone when routes or domains change; product-level Admin to create a new Worker.

## Limits and cost

| Item | Limit |
| --- | --- |
| Versions per deployment | 1 or 2 |
| Versions eligible for a gradual deployment | last 100 uploaded |
| Rollback targets | 100 most recently published versions |
| `versions list` / `deployments list` output | 10 most recent per the command reference (the Versions overview page says 100) |
| Version URL aliases retained | 1000 most recently deployed |
| Alias + worker name (joined by a dash) | <= 63 characters; lowercase letters, digits, dashes; starts with a letter |
| Routes with `wrangler dev --remote` | 50 per zone |

The docs fetched for this card give no price for deploy, versions or rollback operations themselves. Traffic on the deployed version is billed per the Workers plan; `workers.dev` is treated as a Free website and is not recommended for production.

## Sources

- https://developers.cloudflare.com/workers/wrangler/commands/workers/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/wrangler/environments/
- https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
- https://developers.cloudflare.com/workers/versions-and-deployments/
- https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/
- https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/
- https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/workers/authorization/workers/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/previews/get-started/
