# Auth, API tokens and secrets

> **Use when:** a Wrangler command needs a Cloudflare account, you must set up credentials for a headless agent or CI, or you must store a secret.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

## Default path

### 1. Check what is already there

```sh
npx wrangler whoami --json   # non-zero exit if not authenticated
npx wrangler whoami --account <ACCOUNT_ID_OR_NAME>   # membership info for one account
```

### 2. Headless agent or CI: API token in the environment

Wrangler reads these (from the shell, an inline prefix, or a `.env` file in the project directory):

```sh
export CLOUDFLARE_API_TOKEN=<token>      # never echo, never commit
export CLOUDFLARE_ACCOUNT_ID=<account id>
npx wrangler whoami
```

`CLOUDFLARE_API_TOKEN` (and the legacy `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`) take priority over stored OAuth credentials. `account_id` can also be set in `wrangler.jsonc`.

### 3. Human at a keyboard: OAuth

`wrangler login` is interactive. An agent cannot complete it; ask the human to run one of:

```sh
npx wrangler login                          # opens a browser, callback on localhost:8976
npx wrangler login --device                 # no local callback: prints a URL + code, valid 5 minutes (SSH, containers, Codespaces)
npx wrangler login --device --browser=false # print the URL only
npx wrangler login --use-keyring            # store OAuth tokens encrypted, key in the OS keychain
npx wrangler logout
```

### 4. No account yet (agent first deploy)

`npx wrangler deploy --temporary` (Wrangler >= 4.102.0) deploys to a temporary preview account and prints a claim URL the human must open within 60 minutes. It errors if any credential is already available. Not for production or CI. UNVERIFIED locally: `wrangler deploy --help` on 4.147.0 does not list `--temporary`; confirm on the docs page before relying on it.

### 5. Create a least-privilege API token (human, dashboard)

1. Dashboard > **Account API tokens** > **Create Token**. (User tokens: **My Profile** > **API Tokens**.)
2. Under **Permission policies**, open **Custom** and select the **Edit Cloudflare Workers** template.
3. Restrict account resources to the one target account and zone resources to the zones the Worker routes on.
4. Add or remove permissions for what the project really uses (table below), optionally set a TTL and client IP filter.
5. Copy the secret: it is shown once.

Verify a user token without Wrangler (expect `"status": "active"`):

```sh
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

The **Edit Cloudflare Workers** template grants:

| Scope | Permission |
| --- | --- |
| Account | Workers Scripts Write, Workers KV Storage Write, Workers R2 Storage Write, Workers Tail Read, Account Settings Read |
| Zone | Workers Routes Write |
| User | User Details Read, Memberships Read |

Add per product (account scope; names are "Write" on account-owned tokens and "Edit" on user tokens):

| Need | Permission |
| --- | --- |
| D1 | D1 Write (not in the template) |
| KV | Workers KV Storage Write (in the template; remove if unused) |
| R2 | Workers R2 Storage Write (in the template; remove if unused) |
| Queues | Queues Write |
| Hyperdrive | Hyperdrive Write |
| Vectorize | Vectorize Write |
| Workers AI | Workers AI Read or Workers AI Write |
| Secrets Store | Secrets Store Write |
| Routes / Custom Domains | Zone > Workers Routes > Write on every affected zone |

Workers roles for tokens and members (new model; legacy permissions such as Workers Scripts Edit still work, no deprecation date):

| Action | Minimum role |
| --- | --- |
| `wrangler tail` | Metadata Read-Only on that Worker |
| `wrangler deploy` (existing Worker), `versions upload`, `versions deploy`, `rollback`, `secret put`, `secret delete` | Editor on that Worker |
| `wrangler deploy` that changes routes or custom domains | Editor + Workers Routes Write on each affected zone |
| `wrangler deploy` that creates a new Worker | product-level Admin |

Editor cannot create or delete Workers. Per-Worker roles cannot be granted for a Worker that does not exist yet.

### 6. Account ID

- Dashboard: **Search** (Cmd/Ctrl+K) > `Copy account ID`, or **Workers & Pages** > **Account Details**, or a zone's **Overview** > **API** section (also shows the Zone ID).
- CLI: `npx wrangler whoami --json` returns `accounts[].id` and `accounts[].name` (checked against Wrangler 4.147.0; the docs do not describe the fields). The output also contains the account email: read the ID with a filter such as `jq -r '.accounts[].id'` and do not print the rest.

### 7. Worker secrets (per Worker)

```sh
printf '%s' "$VALUE" | npx wrangler secret put API_KEY      # piped stdin, no prompt
npx wrangler secret put API_KEY --env production
npx wrangler secret list                                    # JSON by default; names only, never values
npx wrangler secret bulk secrets.json                       # up to 100 per command; JSON {"K":"v"} or .env; stdin if no file
npx wrangler secret delete API_KEY                          # **DESTRUCTIVE**
npx wrangler deploy --secrets-file .env.production          # upload secrets with the code; omitted secrets are kept
```

- `secret put` and `secret delete` create a new version and deploy it immediately. During a gradual deployment use `npx wrangler versions secret put|delete|bulk` and then `npx wrangler versions deploy`.
- In a bulk JSON file, `"KEY": null` deletes that secret (**DESTRUCTIVE**; Wrangler >= 4.97.0, JSON only).
- Local development values go in `.dev.vars` or `.env` (see `02-project-setup.md`).

### 8. Account-level secrets (Secrets Store, beta)

```sh
npx wrangler secrets-store store list
npx wrangler secrets-store secret create <STORE_ID> --name MY_SECRET_NAME --scopes workers --remote   # prompts for the value
```

Without `--remote` the secret is created for local development only. Production secrets cannot be read from local dev.

The newer `cf` CLI is covered in [`14-agent-tooling.md`](./14-agent-tooling.md).

## Config

```jsonc
{
  // Declare required secret names (not values). Deploy fails if one is missing on the Worker.
  "secrets": { "required": ["API_KEY", "DB_PASSWORD"] },
  // Secrets Store binding
  "secrets_store_secrets": [
    { "binding": "MY_SECRET", "store_id": "<STORE_ID>", "secret_name": "MY_SECRET_NAME" }
  ]
}
```

`.env` for Wrangler's own credentials (git-ignored; `.env.<environment>` replaces it under `--env <environment>`, the two are not merged):

```bash
CLOUDFLARE_ACCOUNT_ID=<YOUR_ACCOUNT_ID_VALUE>
CLOUDFLARE_API_TOKEN=<YOUR_API_TOKEN_VALUE>
```

## Code

```ts
import { env } from "cloudflare:workers";

export default {
  async fetch(request: Request, e: Env): Promise<Response> {
    const perWorker = e.API_KEY;              // Worker secret: plain string on env (or the imported `env`)
    const account = await e.MY_SECRET.get();  // Secrets Store binding: async get()
    return new Response(perWorker && account ? "ok" : "missing", { status: 200 });
  },
};
```

## Verify

- `npx wrangler whoami --json` exits 0 and shows the expected account.
- `npx wrangler secret list` shows the secret name with `"type": "secret_text"`.
- `npx wrangler auth token --json` reports which credential type is active (`api_token`, `oauth`, `api_key`). It prints the token: never log its output.

## Gotchas

- Never commit: `.dev.vars*`, `.env*`, API tokens, Deploy Hook URLs, `secrets.json` / any `--secrets-file` input. Add `.dev.vars*` and `.env*` to `.gitignore` (auto-config also adds `.wrangler`).
- Never put a secret in `vars`: `vars` are plaintext in the config and the dashboard.
- During local dev, values in `.env` are also loaded into the Worker's `env`, so a `CLOUDFLARE_API_TOKEN` kept there is visible to Worker code locally. Prefer shell environment variables for credentials, or restrict loading with `secrets.required`.
- Default OAuth storage is a plaintext TOML file under the global Wrangler config directory (typically `~/.config/.wrangler/config/default.toml`). `--no-use-keyring` deletes the encrypted file and keychain entry.
- Secrets are not inherited by environments: set them per `--env`.
- A deploy never deletes secrets; only `secret delete` (or a `null` in bulk JSON) does.
- Workers Builds currently supports user tokens only, not account-owned tokens.
- `WRANGLER_LOG_SANITIZE` defaults to `true`; do not turn it off when sharing debug logs.

## Limits and cost

- `wrangler secret bulk`: up to 100 secrets per command.
- `wrangler login --device`: code expires after 5 minutes. `deploy --temporary`: claim within 60 minutes.
- Secrets Store is beta. Creating secrets needs the Super Administrator or Secrets Store Admin role; binding one needs Super Administrator or Secrets Store Deployer.
- `secret put` / `secret delete` trigger a production deployment; treat them like `wrangler deploy`.

## Sources

- https://developers.cloudflare.com/workers/wrangler/commands/general/
- https://developers.cloudflare.com/workers/wrangler/commands/workers/
- https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/workers/authorization/workers/
- https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- https://developers.cloudflare.com/fundamentals/api/reference/template/
- https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/workers/local-development/environment-variables/
- https://developers.cloudflare.com/secrets-store/integrations/workers/
- https://developers.cloudflare.com/workers/platform/claim-deployments/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
