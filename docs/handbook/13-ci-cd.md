# CI/CD: Workers Builds, GitHub Actions, deploy hooks

> **Use when:** deploys must run on git push, pull requests need a preview URL, or an external system must trigger a build.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

Pick one: **Workers Builds** (Cloudflare builds from the connected repo; setup is in the dashboard) or **external CI** (GitHub Actions runs Wrangler with an API token; fully scriptable by an agent). Recommendation (not from the docs): do not run both against the same Worker and branch.

## Default path

### A. Workers Builds (Git integration)

Connecting a repository is a dashboard action. Ask the human to do it; an agent prepares the repo.

1. Make sure `name` in the Wrangler config (in the chosen root directory) equals the Worker name in the dashboard, or the build fails.
2. Pin Wrangler in `package.json` (`npm i -D wrangler@latest`): Workers Builds uses that version.
3. Human, new Worker: **Workers & Pages** > **Create application** > **Import a repository** > select Git account and repo > **Save and Deploy**.
   Human, existing Worker: Worker > **Settings** > **Builds** > **Connect**.
4. Build settings (Worker > **Settings** > **Build**):

   | Setting | Default | Notes |
   | --- | --- | --- |
   | Git branch (production) | repo default branch | every push builds and deploys |
   | Build command | none | for example `npm run build` |
   | Deploy command | `npx wrangler deploy` | **COST** live; e.g. `npx wrangler deploy --env staging`, `npm run deploy` |
   | Preview command | `npx wrangler preview` | runs for non-production branches when **Enable Preview Builds** is on |
   | Root directory | repo root | where the Wrangler config lives (monorepos) |
   | API token | auto-generated user token | or select your own |
   | Build variables and secrets | none | build-time only, not available at runtime |

5. Push a commit. Production branch: build command, then deploy command. Other branches (preview builds on): build command, then Preview command.

Variants:

- Upload without releasing on the production branch: set the deploy command to `npx wrangler versions upload`.
- Preview command `npx wrangler versions upload` gives a Version URL instead of a Preview (production settings, no branch isolation).
- Wrangler environments: deploy each environment once from the CLI, connect the repo to each `<name>-<env>` Worker, and add `--env <env>` to its deploy and Preview commands.
- Monorepo: connect the repo to each Worker, set each root directory, optionally set build watch paths.
- No Wrangler config in the repo: auto-config runs non-interactively and opens a pull request with the configuration (GitHub and GitLab; not for Artifacts repositories).
- Supported Git hosts: GitHub, GitLab, Cloudflare Artifacts (a Cursor Origin integration page also exists).
- GitHub pull requests get a comment with build status and the Preview URL, plus check runs per Worker.

Variables injected into every build: `CI=true`, `WORKERS_CI=1`, `WORKERS_CI_BUILD_UUID`, `WORKERS_CI_COMMIT_SHA`, `WORKERS_CI_BRANCH`.

### B. GitHub Actions (official action, as pinned in the docs)

1. Create the API token and find the account ID (`03-auth-and-tokens.md`).
2. Store both as repository secrets (interactive value prompts: hand to the human, or pipe the value in):

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```

3. Add `.github/workflows/deploy.yml` (exact example from the docs; add install/build/test steps before the deploy step as the project needs):

   ```yaml
   name: Deploy Worker
   on:
     push:
       branches:
         - main
   jobs:
     deploy:
       runs-on: ubuntu-latest
       timeout-minutes: 60
       steps:
         - uses: actions/checkout@v6
         - name: Build & Deploy Worker
           uses: cloudflare/wrangler-action@v4
           with:
             apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
             accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
   ```

   The workflow runs `wrangler deploy` (**COST** live on every push to `main`). UNVERIFIED: other `wrangler-action` inputs (for example a custom command or environment) are not shown in the Cloudflare docs; read the action's README before using them, or call Wrangler directly as below.

4. Calling Wrangler directly in a step (any command, any CI system):

   ```yaml
   - name: Deploy
     run: npx wrangler deploy --strict
     env:
       CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
       CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
   ```

5. Preview per pull request (Wrangler >= 4.135.0), `.github/workflows/preview.yml` from the docs:

   ```yaml
   name: Preview
   on:
     pull_request:
       types: [opened, synchronize, reopened, closed]
   permissions:
     contents: read
     pull-requests: write
   jobs:
     preview:
       if: github.event.action != 'closed'
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - id: preview
           name: Create or update Preview
           run: |
             set -o pipefail
             output="$(npx wrangler preview --name "pr-${{ github.event.pull_request.number }}" --json)"
             printf '%s\n' "$output"
             preview_url="$(printf '%s' "$output" | jq -er '.preview.urls[0]')"
             echo "preview_url=$preview_url" >> "$GITHUB_OUTPUT"
           env:
             CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
             CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
         - name: Comment Preview URL
           run: gh pr comment "${{ github.event.pull_request.number }}" --body "Preview: ${{ steps.preview.outputs.preview_url }}"
           env:
             GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     cleanup:
       if: github.event.action == 'closed'
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - name: Delete Preview   # DESTRUCTIVE: removes the Preview and all its deployments
           run: npx wrangler preview delete --name "pr-${{ github.event.pull_request.number }}" --skip-confirmation
           env:
             CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
             CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
   ```

   The `cleanup` job is **DESTRUCTIVE** (deletes the Preview and all its deployments). Health probe step: `curl --fail --show-error --silent "$PREVIEW_URL/api/health"` with `PREVIEW_URL: ${{ steps.preview.outputs.preview_url }}`.

### C. Deploy hooks (trigger a Workers Build by HTTP)

1. Requires a Worker connected to a Git repository. Human: Worker > **Settings** > **Builds** > **Deploy Hooks** > name + branch > **Create**, copy the URL.
2. Trigger (**COST**: consumes build minutes and, on the production branch, deploys):

   ```sh
   curl -X POST "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/<DEPLOY_HOOK_ID>"
   ```

3. The response `result.build_uuid` identifies the build. A second POST while the build is still `queued` or `initializing` returns the same build with `"already_exists": true`.
4. For token-authenticated triggers with a branch per request, use the Builds API manual build endpoint instead.

## Config

Preview settings live in a `previews` block; Previews do not inherit production settings.

```jsonc
{
  "name": "my-worker",
  "vars": { "ENVIRONMENT": "production" },
  "previews": {
    "vars": { "ENVIRONMENT": "preview" }
    // preview-specific bindings go here; the block may be empty
  }
}
```

## Verify

- Workers Builds: Worker > **Deployments** > **View build history**; the pull request shows a Cloudflare comment and check run. A production build creates a new version (`npx wrangler versions list --json`).
- GitHub Actions: the workflow run is green, then `npx wrangler deployments status --json` shows the new version.
- Deploy hook: response has `"success": true`; builds started by a hook are recorded with `build_trigger_source: "deploy_hook"`.
- Types gate in CI: `npx wrangler types --check` exits 1 when generated types are stale.

## Gotchas

- Worker name mismatch between the dashboard and the Wrangler config `name` fails the build.
- Workers Builds does not honor Custom Builds (`build` in the Wrangler config); set the build command in the dashboard.
- Workers Builds API tokens: only user tokens are supported today. The auto-created token has Account Settings (read), Workers Scripts (edit), Workers KV Storage (edit), Workers R2 Storage (edit), Workers Routes (edit, all zones), User Details (read), Memberships (read). It has no D1 permission: supply your own token if the deploy needs more.
- A Preview is not a Worker version, an active deployment or a gradual deployment. Preview URLs are public by default; protect them with Cloudflare Access.
- In a Preview, service bindings call the bound Worker's production deployment, routes and Cron Triggers target production, and queue consumers cannot target a Preview. KV, D1 and R2 are isolated only if the `previews` block binds separate resources.
- Workers connected to Builds before Worker Previews keep the old preview model until a one-time switch in the dashboard. The switch cannot be reversed.
- Workers with Containers: use `wrangler deploy` on the production branch; `versions upload` does not update container images.
- Auto-provisioned resources created by a dashboard/Git deploy do not get their IDs written back to the repository.
- GitHub repository secrets are unavailable to forked pull requests by default. Before exposing Cloudflare credentials check `github.event.pull_request.head.repo.full_name == github.repository`.
- A Deploy Hook URL is its own credential (no `Authorization` header). Store it as a secret; if leaked, delete the hook (**DESTRUCTIVE**: the URL stops working immediately) and create a new one.
- Do not store `CLOUDFLARE_API_TOKEN` in the repository.
- The docs' deploy example pins `actions/checkout@v6` while the preview example pins `actions/checkout@v4`; both are copied as published.

## Limits and cost

Workers Builds:

| Metric | Free plan | Paid plans |
| --- | --- | --- |
| Build minutes | 3,000 per month | 6,000 per month, then $0.005 per minute |
| Concurrent builds | 1 | 6 |
| Build timeout | 20 minutes | 20 minutes |
| CPU | 2 vCPU | 4 vCPU |
| Memory | 8 GB | 8 GB |
| Disk space | 20 GB | 20 GB |
| Environment variables | 64, 5 KB each | 64, 5 KB each |
| Deploy Hooks | 10/min per Worker, 100/min per account | same |

Previews: 100 per Worker on Free, 500 on Paid; 100 deployments per Preview. At the limit Cloudflare deletes the least recently deployed Preview or the oldest deployment.

## Sources

- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/
- https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/
- https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/
- https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/workers/previews/
- https://developers.cloudflare.com/workers/previews/get-started/
- https://developers.cloudflare.com/workers/previews/examples/
- https://developers.cloudflare.com/workers/framework-guides/automatic-configuration/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/wrangler/commands/workers/
