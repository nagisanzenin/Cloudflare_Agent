---
name: cloudflare-ops
description: Set up, deploy and operate a project on Cloudflare (Workers, D1, KV, R2, Durable Objects, Queues, Workflows, Containers) safely. Use whenever a task touches wrangler, wrangler.jsonc, a Cloudflare deploy, rollback, production incident, Cloudflare cost or limits, or moving an app onto Cloudflare. Enforces approval before anything that costs money or deletes data.
---

# Cloudflare operations

This skill is a pointer into the Cloudflare_Agent repository. The guidance lives there so it stays in one place.

1. Find the repository. This skill directory is `skills/cloudflare-ops` inside it, usually reached through a symlink:

   ```bash
   REPO="$(cd "$(realpath "<this skill's base directory>")/../.." && pwd)"
   ```

2. Read `$REPO/AGENTS.md` in full before doing anything else. Its section 1 rules override your defaults: no spending, no deletion, no secret handling and no login without the human.

3. Run the read-only pre-flight in the project you are working on:

   ```bash
   bash "$REPO/scripts/preflight.sh" .
   ```

4. Follow the routing table in `AGENTS.md` to the handbook cards and the runbook for the task. Do not write Cloudflare config or commands from memory: the cards record what changed in 2026.

5. When a card is older than 90 days, or disagrees with what you observe, fetch the live documentation (`<docs URL>/index.md`) and trust it over the card.
