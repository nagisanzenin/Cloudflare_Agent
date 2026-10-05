# Agent tooling: Skills, MCP servers, docs endpoints, `cf` CLI, REST API

> **Use when:** setting up a coding agent (Claude Code, Codex, other) to work on Cloudflare, or when you need a fresh fact, an API call, or a command that Wrangler does not have.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

## Default path

1. **Claude Code**: start `claude` in the project root (where `wrangler.jsonc` or `cloudflare.config.ts` lives), then run these two slash commands. They install Cloudflare Skills and register the Cloudflare MCP servers.
   ```txt
   /plugin marketplace add cloudflare/skills
   /plugin install cloudflare@cloudflare
   ```
2. **Codex CLI**: start `codex` in the project root, run `/plugins`, then search for and install **Cloudflare**. Codex desktop app: **Plugins** > install **Cloudflare**. Manual MCP registration (from the Codex troubleshooting section):
   ```sh
   codex mcp add cloudflare --url https://mcp.cloudflare.com/mcp
   ```
3. **Any agent that supports the Agent Skills standard** (Claude Code, OpenCode, OpenAI Codex, Pi):
   ```sh
   npx skills add https://github.com/cloudflare/skills
   ```
   Or clone `cloudflare/skills` and copy the skill folders into the agent's directory: Claude Code `~/.claude/skills/`, Cursor `~/.cursor/skills/`, OpenCode `~/.config/opencode/skills/`, OpenAI Codex `~/.codex/skills/`, Pi `~/.pi/agent/skills/`. Wrangler also has a global flag `--install-skills` (default false) that installs Cloudflare skills for detected AI coding agents before running the command.
4. **Authorize**: the first Cloudflare tool call redirects to an OAuth page where the owner chooses the permissions to grant. This needs a human in a browser. Unattended (CI): create a Cloudflare API token and pass it as a bearer token in the `Authorization` header (user tokens and account tokens both work).
5. **Fresh facts**: fetch docs as Markdown (see **Docs endpoints**) or use the Documentation MCP server. Do not answer Cloudflare questions from memory.
6. **Commands**: in a project with `wrangler.jsonc` or `wrangler.toml`, use Wrangler. For everything else across the Cloudflare API, use `cf` (beta) or the Cloudflare API MCP server.

## Config

MCP client configuration for the Cloudflare API MCP server (Code Mode):

```json
{
	"mcpServers": {
		"cloudflare-api": {
			"url": "https://mcp.cloudflare.com/mcp"
		}
	}
}
```

Use the Streamable HTTP endpoint at `/mcp`. Historical `/sse` URLs remain as aliases for the same Streamable HTTP handler; they do not serve the deprecated HTTP+SSE transport, so clients that force SSE transport must switch.

Instruction line to add to a user-level `AGENTS.md` or `CLAUDE.md` when `cf` is installed:

```md
When interacting with Cloudflare, use the `cf` CLI unless the project has a
Wrangler configuration file.
```

### MCP servers

Cloudflare describes these as managed remote MCP servers that you connect to using OAuth. The API server also accepts an API token as a bearer token. UNVERIFIED: which individual servers work without any authorization (the docs do not state it per server).

| Server | URL | What it does |
| --- | --- | --- |
| Cloudflare API (Code Mode) | `https://mcp.cloudflare.com/mcp` | Whole Cloudflare API (over 2,500 endpoints) through two tools, `search()` and `execute()`, in about 1,000 tokens |
| Documentation | `https://docs.mcp.cloudflare.com/mcp` | Up-to-date reference information on Cloudflare |
| Workers Bindings | `https://bindings.mcp.cloudflare.com/mcp` | Build Workers applications with storage, AI, and compute primitives |
| Workers Builds | `https://builds.mcp.cloudflare.com/mcp` | Insights into and management of Workers Builds |
| Observability | `https://observability.mcp.cloudflare.com/mcp` | Debug with the application's logs and analytics |
| Radar | `https://radar.mcp.cloudflare.com/mcp` | Global Internet traffic insights, trends, URL scans |
| Container | `https://containers.mcp.cloudflare.com/mcp` | Spin up a sandbox development environment |
| Browser Run | `https://browser.mcp.cloudflare.com/mcp` | Fetch web pages, convert to markdown, take screenshots |
| Logpush | `https://logs.mcp.cloudflare.com/mcp` | Summaries of Logpush job health |
| AI Gateway | `https://ai-gateway.mcp.cloudflare.com/mcp` | Search AI Gateway logs, prompts and responses |
| AI Search (AutoRAG) | `https://autorag.mcp.cloudflare.com/mcp` | List and search documents on AI Search instances |
| Audit Logs | `https://auditlogs.mcp.cloudflare.com/mcp` | Query audit logs and generate reports |
| DNS Analytics | `https://dns-analytics.mcp.cloudflare.com/mcp` | Optimize DNS performance and debug issues |
| Digital Experience Monitoring | `https://dex.mcp.cloudflare.com/mcp` | Insight on critical applications for the organization |
| Cloudflare One CASB | `https://casb.mcp.cloudflare.com/mcp` | Identify security misconfigurations in SaaS applications |
| GraphQL | `https://graphql.mcp.cloudflare.com/mcp` | Analytics data through Cloudflare's GraphQL API |
| Agents SDK Documentation | `https://agents.cloudflare.com/mcp` | Token-efficient search of the Agents SDK docs |
| Cloudflare Blog | `https://blog.mcp.cloudflare.com/mcp` | Search and read Cloudflare Blog posts (listed in the agent-setup guides only) |
| Demo Day | `https://demo-day.mcp.cloudflare.com/mcp` | Minimal demo MCP server (listed in the agent-setup guides only) |

Audit Logs, GraphQL and Agents SDK Documentation appear in the MCP catalog page but not in the agent-setup guides' list. Source repos: `cloudflare/mcp` (API server), `cloudflare/mcp-server-cloudflare` (product servers).

### Skills in the `cloudflare/skills` bundle

`agents-sdk`, `basin`, `cloudflare`, `cloudflare-email-service`, `cloudflare-one`, `cloudflare-one-migrations`, `durable-objects`, `k2`, `nextjs-on-cloudflare`, `sandbox-migrate-to-next`, `sandbox-next`, `sandbox-stable`, `turnstile-spin`, `web-perf`, `workers-best-practices`, `wrangler`. Slash commands from the plugin: `/cloudflare:build-agent` (scaffold an Agents SDK project), `/cloudflare:build-mcp` (remote MCP server).

### Docs endpoints

| Endpoint | Use |
| --- | --- |
| `https://developers.cloudflare.com/llms.txt` | Index of every product, with links to each product's `llms.txt` |
| `https://developers.cloudflare.com/<product>/llms.txt` | Page index for one product (for example `/workers/llms.txt`, `/d1/llms.txt`, `/cf/llms.txt`) |
| `https://developers.cloudflare.com/<product>/llms-full.txt` | Full content of one product's docs |
| `https://developers.cloudflare.com/llms-full.txt` | Full content of all docs in one file |
| `<any docs page URL>/index.md` | Markdown twin of that page |
| Any docs page with header `Accept: text/markdown` | Same Markdown; response carries `x-markdown-tokens` and `x-original-tokens` |
| `https://developers.cloudflare.com/workers/prompt.txt` | Workers code-generation system prompt; still served (HTTP 200 on 2026-10-05) |
| `https://developers.cloudflare.com/changelog/rss/<product>.xml` | Changelog feed per product (for example `workers.xml`, `billing.xml`) |

```sh
curl -sS -o page.md https://developers.cloudflare.com/workers/platform/limits/index.md
curl "https://developers.cloudflare.com/workers/get-started/" --header "Accept: text/markdown"
```

### `cf` CLI (beta)

- What: one CLI for the public Cloudflare API (more than 2,900 commands, most generated from the API schemas) and for Workers projects configured with `cloudflare.config.ts`. Beta since changelog 2026-09-28; commands, configuration and Build Output can change before the stable release.
- Requirements: Node.js 22.18 or later. Bun is not supported for commands that load `cloudflare.config.ts`.
- Install: `npm install --global cf` (also installs the alias `cloudflare`). Check: `cf --version`. Update: `npm install --global cf@latest`.
- Auth: `cf auth login` (prints a link and a one-time code; add `--no-browser` on a remote machine; `--force` to sign in again), then `cf auth whoami`. `cf` keeps its own credentials and does not reuse a Wrangler login. It does not support the Global API Key.
- Unattended: `export CLOUDFLARE_API_TOKEN=<API_TOKEN>` and `export CLOUDFLARE_ACCOUNT_ID=<ACCOUNT_ID>`. The token takes priority over any stored login. Credential order: `CLOUDFLARE_API_TOKEN` (also from `.env`), `--profile <NAME>`, the profile bound with `cf auth activate`, the default profile.
- Find and run a command:
  ```sh
  cf cli search "create D1 database"        # local, no credentials, up to five JSON matches; quote the task
  cf schema d1 create                       # API request shape: operationId, httpMethod, path, params, body fields
  cf d1 create --name my-database --dry-run # print the request as JSON without sending; needs no credentials
  ```
- Output: results are JSON on stdout; messages and errors go to stderr; a failed command exits non-zero. Lists return one page.
- Relation to Wrangler: Wrangler is the CLI for projects with `wrangler.jsonc` or `wrangler.toml`; `cf` uses `cloudflare.config.ts`, modes (`--mode`) instead of `env` blocks, and resource IDs instead of names. `cf` resource commands (for example `cf d1 list`, `cf r2 buckets list`) work next to an unmigrated Wrangler project. Migrate with `cf migrate --dry-run`, then `cf migrate`.
- Still needs Wrangler: live logs (`npx wrangler tail <WORKER_NAME>`) and setting a single secret.

### REST API

- Base URL: `https://api.cloudflare.com/client/v4/`
- Auth: `Authorization: Bearer <API_TOKEN>` (API tokens preferred over the legacy Global API key).
- Reference: https://developers.cloudflare.com/api/
- OpenAPI specification (JSON): https://github.com/cloudflare/api-schemas
- Local dev API: `http://localhost:8787/cdn-cgi/local/explorer/api` serves its own OpenAPI spec while `wrangler dev` runs (card 09).

## Verify

- Claude Code: `claude mcp list` shows the Cloudflare servers as connected.
- Codex: `codex mcp list` shows the server; `/mcp` inside the Codex TUI shows its status.
- `cf --version` prints a version; `cf auth whoami` prints the signed-in identity; `cf zones list` returns a JSON array.
- Docs: `curl -sS -o /dev/null -w "%{http_code}" https://developers.cloudflare.com/workers/llms.txt` prints `200`.

## Gotchas

- **Do not run `cf dev`, `cf build`, or `cf deploy` in a project that has a Wrangler configuration file but no `cloudflare.config.ts`.** They can fail, or generate a new configuration that ignores `wrangler.jsonc` and rewrite `package.json` (including the `deploy` script), the lockfile, `.gitignore` and `vite.config.ts`; without a terminal (CI) this happens without confirmation. Run `cf migrate` first. To undo: `git status`, `git restore <file>`, delete the new files (`cloudflare.config.ts`, `wrangler.config.ts`, `.cloudflare/`).
- **DESTRUCTIVE** In a non-interactive session a destructive `cf` command without `--force` prints `Aborted.` to stderr and exits with status `0`. Exit 0 does not mean the resource was deleted. On some commands `--force` is also an API parameter: `cf workers delete --force` also deletes a Worker that other Workers still reference.
- `cf cli search` takes the whole task as one quoted argument; unquoted words after the first fail as unknown commands.
- `cf` commands hit remote resources by default. `--local` works only for supported KV, D1 (`cf d1 raw`, `cf d1 migrations list`, `cf d1 migrations apply`) and R2 commands; `cf d1 query` with `--local` returns an error.
- `cf` resource commands do not read `account_id` from the Wrangler file. Set `CLOUDFLARE_ACCOUNT_ID`; in a non-interactive session a command fails if the credentials can access more than one account and none is set or saved.
- `cf` reads only `.env` (not `.env.local` or `.env.<MODE>`). Do not commit API tokens.
- OAuth and `cf auth login` need the owner in a browser; an agent cannot complete them alone.
- An OAuth grant gives the agent the permissions the owner selected. Since changelog 2026-08-22, Wrangler and the Cloudflare API MCP server use optional OAuth scopes; a declined scope requires reauthorizing.
- If the MCP server fails to connect in Claude Code: `claude mcp list`, then `claude mcp remove cloudflare` and re-add it. Codex: remove and re-add the server and complete the OAuth flow.
- A Workers Issues automation does not give the destination agent account access; configure the Observability MCP server separately (card 09).

## Limits and cost

| Item | Cost / limit |
| --- | --- |
| Skills, MCP servers, docs endpoints, `cf` CLI | No price is documented on the pages read |
| Actions taken through MCP `execute()`, `cf`, or the REST API | **COST** Billed like any other use of the product (card 10). `cf <command> --dry-run` sends nothing. |
| Code Mode token overhead | about 1,000 tokens (2 tools) versus about 1,170,000 for native MCP with full schemas (2,594 tools) |

## Sources

- https://developers.cloudflare.com/agent-setup/index.md
- https://developers.cloudflare.com/agent-setup/claude-code/index.md
- https://developers.cloudflare.com/agent-setup/codex/index.md
- https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/index.md
- https://developers.cloudflare.com/docs-for-agents/index.md
- https://developers.cloudflare.com/llms.txt and https://developers.cloudflare.com/workers/llms.txt
- https://developers.cloudflare.com/workers/prompt.txt
- https://developers.cloudflare.com/cf/index.md
- https://developers.cloudflare.com/cf/get-started/index.md
- https://developers.cloudflare.com/cf/agents/index.md
- https://developers.cloudflare.com/cf/wrangler/index.md
- https://developers.cloudflare.com/cf/llms.txt
- https://developers.cloudflare.com/changelog/post/2026-09-28-cloudflare-cli-beta/ (title read via https://developers.cloudflare.com/changelog/product/workers/index.md)
- Changelog entry of 2026-08-22 on optional OAuth scopes for Wrangler and the Cloudflare API MCP server, in https://developers.cloudflare.com/changelog/rss/workers.xml
- https://developers.cloudflare.com/workers/wrangler/commands/general/index.md (`--install-skills`)
- https://developers.cloudflare.com/fundamentals/api/how-to/make-api-calls/index.md
- https://developers.cloudflare.com/workers/local-development/local-explorer/index.md
