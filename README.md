# Cloudflare_Agent

A handbook for AI coding agents that have to put a project on Cloudflare and keep it running.

Point Claude Code, Codex or another agent at this repo and it gets:

- **Rules** that stop it spending money, deleting data or leaking secrets without asking you: [AGENTS.md](AGENTS.md)
- **Cards** with the exact commands, config and limits for each Cloudflare product, dated and sourced: [docs/handbook](docs/handbook/README.md)
- **Runbooks** for setup, release, incident and teardown: [docs/runbooks](docs/runbooks)
- **Templates** that were compiled and run locally: [templates](templates)
- **A pre-flight script** that checks a project before the agent touches Cloudflare: [scripts/preflight.sh](scripts/preflight.sh)

Everything was verified on 2026-10-05 against Wrangler 4.147.0. [STATUS.md](STATUS.md) says exactly what was checked and what was not. Nothing here was tested with a live deploy.

## Why this exists

Cloudflare changes fast, and agents answer from old training data. In 2026 alone the Durable Object config format changed, Node.js compatibility became the default, the Sandbox SDK was rewritten, and Wrangler started creating resources on deploy. An agent that does not know this writes config that fails, or worse, config that works and costs money.

Cloudflare publishes its own [Skills and MCP servers](https://developers.cloudflare.com/agent-setup/) for agents. Install them: they are the product knowledge, kept current by Cloudflare. This repo is the layer on top: safety rules, an operating procedure, a dated snapshot you can read offline, and templates you can run.

## Use it

1. Clone it somewhere stable:

   ```bash
   git clone https://github.com/nagisanzenin/Cloudflare_Agent.git ~/Cloudflare_Agent
   ```

2. Tell your agent to read it. Add this line to the `AGENTS.md` or `CLAUDE.md` of the project you want on Cloudflare (or to your user-level file):

   ```md
   Before any Cloudflare work, read ~/Cloudflare_Agent/AGENTS.md and follow it.
   ```

   Claude Code users can install it as a skill instead:

   ```bash
   ln -s ~/Cloudflare_Agent/skills/cloudflare-ops ~/.claude/skills/cloudflare-ops
   ```

3. Install Cloudflare's own tooling once. In Claude Code:

   ```txt
   /plugin marketplace add cloudflare/skills
   /plugin install cloudflare@cloudflare
   ```

   Other agents: [docs/handbook/14-agent-tooling.md](docs/handbook/14-agent-tooling.md).

4. Ask for what you want: "put this app on Cloudflare", "add a database", "deploy", "why is production failing".

## If you are new to cloud

Start with the glossary in [docs/handbook/00-mental-model.md](docs/handbook/00-mental-model.md). The agent is told to explain each step in those terms before it does anything that costs money or cannot be undone.

## Try a template

No Cloudflare account is needed to run any of them locally.

```bash
cp -R ~/Cloudflare_Agent/templates/worker-api my-app
cd my-app && npm install
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

| Template | Shows |
| --- | --- |
| [worker-api](templates/worker-api) | HTTP API with D1 (SQL) and KV (cache) |
| [fullstack-assets](templates/fullstack-assets) | Static files plus an API in one Worker |
| [durable-object](templates/durable-object) | Per-name state with a private SQLite database |
| [background-jobs](templates/background-jobs) | Workflow, Queue and Cron Trigger |
| [container](templates/container) | A Linux container behind a Worker (needs Docker) |

## Keep it current

```bash
npm install
npm run verify      # types, typecheck and dry-run bundle for every template; no account, no deploy
```

Cards go stale. Each one carries its verification date and sources; [STATUS.md](STATUS.md) explains how to refresh them. If a card disagrees with Cloudflare's docs, the docs are right.

## Layout

```
AGENTS.md            rules, routing table, defaults (the entry point for agents)
CLAUDE.md            imports AGENTS.md for Claude Code
STATUS.md            what was verified, what was not, open items
docs/handbook/       one card per topic
docs/runbooks/       setup, release, incident, teardown
templates/           five runnable starting points
scripts/             preflight.sh, verify-templates.sh
skills/              the same guidance packaged as a Claude Code skill
```
