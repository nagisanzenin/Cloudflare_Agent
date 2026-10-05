# Runbook: tear a project down

Everything here is **DESTRUCTIVE**. Deleted data cannot be recovered. Do not start without the human's explicit request, and do not delete anything they have not confirmed by name.

## 1. Inventory

List what the project owns. Read the names from `wrangler.jsonc`, then confirm each exists:

```bash
npx wrangler deployments status
npx wrangler d1 list
npx wrangler kv namespace list
npx wrangler r2 bucket list
npx wrangler queues list
npx wrangler containers list
```

Show the human the list of exactly what will be deleted. Point out anything shared with another project: a resource bound by a second Worker must stay.

## 2. Keep a copy of the data

```bash
npx wrangler d1 export <db> --remote --output=./<db>-final.sql
```

For R2, copy the objects out with any S3-compatible tool. For KV, list and save the keys that matter. Confirm with the human that the copies are complete before step 3.

## 3. Delete, in this order

The Worker first, so nothing is still writing while storage is removed.

```bash
npx wrangler delete --dry-run                # shows what would go
npx wrangler delete --name <worker>          # DESTRUCTIVE; may ask for confirmation: let the human answer
npx wrangler d1 delete <db>                  # DESTRUCTIVE
npx wrangler kv namespace delete --namespace-id <id>     # DESTRUCTIVE
npx wrangler r2 bucket delete <bucket>       # DESTRUCTIVE; if it is refused, empty the bucket first
npx wrangler queues delete <queue>           # DESTRUCTIVE
```

Each Wrangler environment is its own Worker: repeat with `--env <name>` for `staging` and the others.

Check each command's `--help` before running it: flags for these commands change between Wrangler versions.

## 4. Things a deleted Worker leaves behind

- Custom domains and routes: remove them in the config before the last deploy, or in the dashboard. A deleted custom domain leaves its certificate behind.
- Container images in the Cloudflare registry: `npx wrangler containers images list`.
- Secrets Store secrets, API tokens created for CI, and deploy hooks.
- GitHub repository secrets (`CLOUDFLARE_API_TOKEN`) and the workflow that used them.
- The Workers Paid subscription itself. Deleting every resource does not cancel the $5 monthly minimum; only the human can cancel it in the dashboard.

## 5. Verify

Run the commands from step 1 again. Report to the human what was deleted, what was kept and why, where the data copies are, and what is still billed.
