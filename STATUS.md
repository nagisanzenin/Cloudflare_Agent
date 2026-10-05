# Status

What in this repo was checked, how, and what was not. Update this file whenever a card or template is refreshed.

## Last verification

- Date: 2026-10-05
- Wrangler 4.147.0 (declares Node.js >= 22), TypeScript 5.9.3, `@cloudflare/containers` 0.3.7
- Machine: macOS on Apple silicon, Node.js 25.5.0, Docker 27.4.0

## What was checked

| Item | How | Result |
| --- | --- | --- |
| Handbook cards 02 to 14 | Written from Cloudflare's docs fetched as Markdown on the date above; sources listed in each card | Each card names what it could not confirm with `UNVERIFIED:` |
| CLI flags cited in the cards and runbooks | Compared with `wrangler <command> --help` | Match, except the two flags listed under open items |
| Code samples in cards 04b, 05, 06, 07b | Extracted, `wrangler types`, `tsc --noEmit`, `wrangler deploy --dry-run` | Compile and bundle cleanly |
| Templates `worker-api`, `durable-object`, `background-jobs`, `fullstack-assets`, `container` | `npm run verify` (types, typecheck, dry run) | 5 of 5 pass |
| Same five templates | Run under `wrangler dev`, every route requested with `curl` | Behave as their READMEs say. `container` built and answered through Docker |
| `scripts/preflight.sh` | Run against a template, an empty directory and a project with a syntax error | Reports PASS, FAIL and exit codes as intended |
| `wrangler whoami --json` exit code | Run with and without credentials | 0 when authenticated, 1 when not |
| Resource bindings without IDs | `wrangler types`, dry run and local D1 migration on a config with no IDs | Work locally |

## What was not checked

- **Nothing was deployed.** No command in this repo was run against a Cloudflare account, apart from the read-only `wrangler whoami`. Deploy, rollback, gradual rollout, `tail`, resource creation, deletion and CI steps come from the docs and from `--help`, not from a live run.
- Code samples in cards 02, 03, 04, 04c, 07, 11 and 12 were not compiled. Some are fragments; others need packages or accounts that were not set up.
- Prices and limits were copied from the docs on the date above and were not checked against an invoice.

## Open items

Marked `UNVERIFIED:` in the cards:

- 03, 08: `wrangler deploy --temporary` is documented but not listed by `wrangler deploy --help` in 4.147.0. The same holds for `--yes` on `deploy` (02, 08).
- 04c: the output fields of `wrangler hyperdrive get`.
- 07b: the API of `@cloudflare/computer`; only a blog post mentions it.
- 08: whether any flag skips the `wrangler delete` confirmation.
- 09: where `persist: false` goes in the traces config.
- 10: the token permission the Billable Usage API needs.
- 12: `cf k2 streams create` and `wrangler basin catalog create` appear only in launch blog posts.
- 13: inputs of `cloudflare/wrangler-action` other than `apiToken` and `accountId`.
- 14: which of Cloudflare's MCP servers work without authorization.

Places where Cloudflare's own docs disagree with each other (the cards say which reading they use):

- The default target of `wrangler d1 execute` when neither `--local` nor `--remote` is given.
- Whether `versions list` shows 10 or 100 entries.
- Workflows concurrency on Paid: a table says 50,000, a paragraph says 10,000.
- The minimum Node.js version for Wrangler: the docs do not state one; the npm package declares 22.

## How to re-verify

1. `npm install && npm run verify` (Docker running, or the container template is skipped).
2. For each card, fetch its sources as Markdown (`<docs URL>/index.md`), correct the card and its date.
3. Compare changed commands with `npx wrangler <command> --help`.
4. Update the tables above.
