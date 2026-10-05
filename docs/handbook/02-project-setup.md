# Project setup: new project, existing project, wrangler.jsonc, local dev

> **Use when:** you must create a Workers project, put an existing app on Workers, or write/repair `wrangler.jsonc` and the local dev loop.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

## Default path

### A. New project, no prompts (C3 = `create-cloudflare`)

C3 is interactive unless every required choice is passed as a flag. `--deploy`, `--git` and `--open` all default to `true`, so turn off what you do not want.

```sh
# Plain Worker, TypeScript, no deploy, no browser
npm create cloudflare@latest -- my-worker --type=hello-world --lang=ts --git --no-deploy --no-open

# Framework starter (--type is ignored when --framework is set); args after the second `--` go to the framework's own CLI
npm create cloudflare@latest -- my-app --framework=react --no-deploy --no-open

# From a git template (must contain package.json, a Wrangler config, and src/)
npm create cloudflare@latest -- my-worker --template=user/repo --no-deploy --no-open
```

- `--type`: `hello-world`, `hello-world-durable-object`, `common`, `scheduled`, `queues`, `openapi`, `pre-existing`.
- `--framework`: `angular`, `astro`, `docusaurus`, `gatsby`, `hono`, `next`, `nuxt`, `qwik`, `react`, `redwood`, `remix`, `solid`, `svelte`, `vue`.
- `--lang`: `ts` (default), `js`, `python`. `--ts` is deprecated.
- `--category`: `hello-world`, `web-framework`, `demo`, `remote-template`.
- `-y` / `--accept-defaults` takes every default (defaults include deploy = true; still pass `--no-deploy`).
- `--existing-script <name>` clones an existing Worker script locally (`--type` becomes `pre-existing`, deploy is ignored).
- C3 creates a Workers project unless `--platform=pages` is passed.
- Opt out of C3 telemetry: `export CREATE_CLOUDFLARE_TELEMETRY_DISABLED=1`.

### B. Existing project (auto-config, Wrangler >= 4.68.0)

Runs only when no Wrangler config file exists. It detects the framework, installs the adapter, writes `wrangler.jsonc`, adds `deploy` / `preview` / `cf-typegen` scripts, and updates `.gitignore`.

```sh
npm i -D wrangler@latest
npx wrangler setup --dry-run     # print what would change, touch nothing
npx wrangler setup --yes         # configure without prompts, do not deploy
npx wrangler setup --yes --build # also run the project's build once
```

- `npx wrangler deploy` with no config file runs the same auto-configuration and then deploys (**COST**: publishes live). The docs give `--yes` to skip its prompts; `wrangler deploy --help` on 4.147.0 lists `--autoconfig` but not `--yes`, so check `--help` first. Prefer `setup`, then deploy.
- Detected: Next.js (via `vinext`), Astro, SvelteKit, Nuxt, React Router, Solid Start, TanStack Start, Angular, Analog, Vite, Vike, Waku, and static sites (any directory with `index.html`).
- Next.js: auto-config uses vinext. For the OpenNext adapter, configure manually from the OpenNext guide.
- Otherwise follow the framework guide: https://developers.cloudflare.com/workers/framework-guides/

### C. Vite project by hand (Cloudflare Vite plugin)

```sh
npm i -D vite @cloudflare/vite-plugin wrangler
```

Add the plugin (see Code), keep `"type": "module"` in `package.json`, and use scripts `vite dev`, `vite build`, `npm run build && vite preview`, `npm run build && wrangler deploy`. With the plugin, select a Wrangler environment with `CLOUDFLARE_ENV=<name>` at dev/build time, not `--env`.

### D. Types and local dev

```sh
npx wrangler types            # writes ./worker-configuration.d.ts (Env + runtime types)
npx wrangler types --check    # exit 1 if the file is stale (use in CI)
npx wrangler dev              # local workerd via Miniflare, http://localhost:8787
npx wrangler dev --env staging
```

Rerun `wrangler types` after every binding or compatibility change.

## Config

`wrangler.jsonc` is the recommended format. `name`, `main` and `compatibility_date` are required to deploy (`main` is optional for assets-only Workers).

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "my-worker",                 // a-z, 0-9, dashes; <= 63 chars if served on workers.dev
  "main": "./src/index.ts",
  "compatibility_date": "2026-10-05",  // set to today's date for a new project
  // "compatibility_flags": [],        // Node.js compat needs no flag from 2026-08-04 (see Gotchas)
  "assets": {
    "directory": "./public",           // omit with the Vite plugin (it points at the client build)
    "binding": "ASSETS",               // only useful when "main" is set
    "not_found_handling": "single-page-application", // or "404-page" | "none" (default)
    "run_worker_first": ["/api/*"]     // boolean or route patterns, max 100 entries
  },
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "vars": { "ENVIRONMENT": "dev" },    // plaintext only, never secrets
  "secrets": { "required": ["API_KEY"] }, // names only; validated on dev and deploy, drives `wrangler types`
  "env": {
    "staging": {
      "vars": { "ENVIRONMENT": "staging" }   // bindings and vars are NOT inherited: restate them per env
    }
  }
}
```

Remote binding during local dev (the Worker still runs locally, the resource is the real one):

```jsonc
{
  "r2_buckets": [
    { "bucket_name": "screenshots-bucket", "binding": "screenshots_bucket", "remote": true }
  ]
}
```

Automatic provisioning: a KV, R2, D1 or Queues binding declared without an ID (or bucket name) is created on `wrangler deploy` and the ID is written back to the config. `wrangler dev` creates local resources that persist between runs.

## Code

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({ plugins: [cloudflare()] });
```

```ts
// src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response(`env=${env.ENVIRONMENT}`);
  },
};
```

## Verify

- `npx wrangler --version` prints a 4.x version from the project's `node_modules`.
- `npx wrangler types --check` exits 0.
- `npx wrangler dev` then `curl -s localhost:8787` returns the Worker response.
- `npx wrangler deploy --dry-run --outdir dist` bundles without uploading; a non-zero exit means config or build errors.

## Gotchas

- **Node.js compat is on by default** for `compatibility_date` >= `2026-08-04`: `nodejs_compat` and `nodejs_compat_v2` are redundant and ignored there. Older dates still need `"compatibility_flags": ["nodejs_compat"]`. To turn it off, set both `no_nodejs_compat` and `no_nodejs_compat_v2`.
- If Wrangler is not installed in the project, `npx wrangler` runs the latest published version. Install it as a dev dependency so versions are pinned.
- Auto-config does not run if any Wrangler config file exists; delete it to reconfigure. Workspace/monorepo detection is limited: the framework must be a dependency of the package you run in.
- Local secrets: use `.dev.vars` or `.env` next to the Wrangler config, not both. If `.dev.vars` exists, `.env` values are not loaded into `env`.
- `.dev.vars.<env>` replaces `.dev.vars` entirely for that environment. `.env` files merge, most specific first: `.env.<env>.local`, `.env.local`, `.env.<env>`, `.env`.
- With `secrets.required` set, only the listed keys are loaded from `.dev.vars` / `.env`.
- `remote: true` is an error on Durable Objects, Workflows, `vars`, secrets, static assets, version metadata, Analytics Engine, Hyperdrive and rate limiting bindings. Use `npx wrangler dev --local` to force every binding local.
- Remote bindings write to real data and are billed at the service's normal rates (**COST**).
- `npx wrangler dev --remote` is the legacy fully-remote mode (**COST**): all bindings hit deployed resources, and it is not supported by the Vite plugin.
- Local `workerd` runs with `TZ=UTC`.
- Workers Sites (`site`, `--site`) is deprecated; use `assets`.
- Do not use underscores in `name`.
- Testing: the integration is now `@cloudflare/vitest-plugin`; `@cloudflare/vitest-pool-workers` has a migration guide. Start at https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/

## Limits and cost

- Wrangler supports the Current, Active and Maintenance Node.js releases; Node 16 is unsupported in Wrangler v4. OS: macOS 13.5+, Windows 11, Linux distros that support glib 2.35 (wording as in the docs).
- `assets.run_worker_first`: at most 100 patterns. One assets collection per Worker.
- Worker name: up to 255 characters, 63 when served on `workers.dev`.
- Local dev simulates all bindings locally by default; remote bindings and `--remote` incur the standard cost of the services they touch.

## Sources

- https://developers.cloudflare.com/pages/get-started/c3/
- https://developers.cloudflare.com/workers/get-started/guide/
- https://developers.cloudflare.com/workers/framework-guides/automatic-configuration/
- https://developers.cloudflare.com/workers/wrangler/commands/workers/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/wrangler/environments/
- https://developers.cloudflare.com/workers/wrangler/install-and-update/
- https://developers.cloudflare.com/workers/wrangler/migration/update-v3-to-v4/
- https://developers.cloudflare.com/workers/vite-plugin/get-started/
- https://developers.cloudflare.com/workers/local-development/
- https://developers.cloudflare.com/workers/local-development/environment-variables/
- https://developers.cloudflare.com/workers/testing/vitest-integration/
- https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/
