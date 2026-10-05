# Runbook: set up a project on Cloudflare

From nothing, or from an existing codebase, to an app that runs locally and is ready for its first deploy. Nothing in steps 1 to 6 touches a Cloudflare account or costs money.

## 0. Ask before you start

Get these from the human. Do not guess them.

- What the app does and roughly how much traffic it expects.
- Whether the Cloudflare account is on Workers Free or Workers Paid.
- A monthly dollar cap. On Free the cap is zero: stay inside the Free limits.
- Whether it needs a custom domain, and which.
- Whether a database already exists elsewhere (then use Hyperdrive, not D1).

## 1. Tooling

- Node.js 22 or later (`node -v`).
- Optional, once per machine: Cloudflare's own Skills and MCP servers ([14-agent-tooling](../handbook/14-agent-tooling.md)).

## 2. Create or adopt

New project, from a template in this repo:

```bash
cp -R <path-to-this-repo>/templates/worker-api my-app
cd my-app && npm install
```

New project, from Cloudflare's generator (flags stop every prompt, and stop it deploying):

```bash
npm create cloudflare@latest -- my-app --type=hello-world --lang=ts --no-deploy --no-open
```

Existing project:

```bash
npm install --save-dev wrangler@latest
npx wrangler setup --dry-run     # shows what would change; show this to the human
npx wrangler setup --yes         # writes wrangler.jsonc, adds scripts, does not deploy
```

Details and framework notes: [02-project-setup](../handbook/02-project-setup.md).

## 3. Choose the pieces

Pick compute with [01-choose-compute](../handbook/01-choose-compute.md) and storage with [04-storage-overview](../handbook/04-storage-overview.md). Add each binding from its card. Leave resource IDs out for now: local dev does not need them.

## 4. Make it run locally

```bash
npx wrangler types
npx wrangler dev
```

Exercise every route you wrote with `curl`. For D1, apply migrations locally first: `npx wrangler d1 migrations apply DB --local`.

Local secrets go in `.dev.vars`, which must be git-ignored.

## 5. Put it under git

Commit the project. Check that `.gitignore` covers `node_modules/`, `.wrangler/`, `.dev.vars*` and `.env*`.

## 6. Pre-flight

```bash
bash <path-to-this-repo>/scripts/preflight.sh .
```

Fix every FAIL. Read every WARN aloud to the human if it concerns auth or uncommitted work.

## 7. Hand over to the release runbook

Before anything is created on the account, tell the human, in plain language:

- What will exist after the first deploy (the Worker, each database, bucket, queue).
- Which of those can cost money, and the cap you will stay under.
- That they need to be logged in: `npx wrangler login`, or a scoped API token ([03-auth-and-tokens](../handbook/03-auth-and-tokens.md)).

Then continue with [release](release.md).
