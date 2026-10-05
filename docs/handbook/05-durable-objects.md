# Durable Objects

> **Use when:** you need one strongly consistent, single-threaded unit of state + compute per entity (room, user, document, agent, rate limiter) with its own private SQLite database, alarms or WebSockets.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

Status: available on Workers Free and Workers Paid. Free plan can only use SQLite-backed classes. New key-value-backed namespaces can no longer be created (existing ones keep working).

## Default path

1. Scaffold (or add the class to an existing Worker):
   ```sh
   npm create cloudflare@latest -- durable-object-starter
   # choose: Hello World example -> Worker + Durable Objects -> TypeScript -> deploy: No
   ```
2. Export a class that extends `DurableObject` (see Code).
3. Add `durable_objects.bindings` **and** an `exports` entry with `"storage": "sqlite"` (see Config). A class that exists only in code is ignored: no namespace is provisioned until it is declared in `exports`.
4. Generate types: `npx wrangler types` (creates `worker-configuration.d.ts` with `Env`).
5. Run locally: `npx wrangler dev`
6. Deploy: `npx wrangler deploy` **COST** (usage-billed beyond the included amounts below). Lifecycle changes (create/rename/delete/transfer) are applied only by `wrangler deploy`.

## Config

New Workers: declare classes in `exports` (replaces the legacy `migrations` array).

```jsonc
{
	"durable_objects": {
		"bindings": [
			{ "name": "MY_DURABLE_OBJECT", "class_name": "MyDurableObject" }
		]
	},
	"exports": {
		"MyDurableObject": { "type": "durable-object", "storage": "sqlite" }
	}
}
```

- Binding fields: `name` (required), `class_name` (required), `script_name` (optional, class lives in another Worker).
- `exports.<ClassName>` fields: `type: "durable-object"`, `state` (`"created"` default, `"deleted"`, `"renamed"`, `"transferred"`, `"expecting-transfer"`), `storage` (`"sqlite"`; `"legacy-kv"` only for namespaces that already exist with KV storage), `renamed_to`, `transferred_to`, `transfer_from`.
- `exports` can be set per environment under `env.<name>.exports`; each environment has its own namespaces.
- Raise CPU per invocation (default 30 s) up to 5 min: `"limits": { "cpu_ms": 300000 }`.

Legacy Workers still on `migrations` (`new_sqlite_classes` / `new_classes`): keep it, or convert by replacing the array with one `exports` entry per live class (`new_sqlite_classes` -> `"sqlite"`, `new_classes` -> `"legacy-kv"`), delete `migrations`, deploy. No data migration. **One-way:** after a deploy with `exports` you cannot return to `migrations`.

Rename (single deploy if the old class is gone from code):

```jsonc
{
	"exports": {
		"OldName": { "type": "durable-object", "state": "renamed", "renamed_to": "NewName" },
		"NewName": { "type": "durable-object", "storage": "sqlite" }
	}
}
```

Zero-downtime rename = 3 deploys: (1) code exports `NewName` plus `export { NewName as OldName }`, config unchanged; (2) add the `renamed` tombstone + live `NewName` entry; (3) remove the alias from code.

Delete a class and ALL its data (**DESTRUCTIVE**, permanent, no trash):

```jsonc
{ "exports": { "OldDurableObject": { "type": "durable-object", "state": "deleted" } } }
```

Preconditions: class removed from code, binding removed, no other Worker binds to it; then `npx wrangler deploy` **DESTRUCTIVE**.

Transfer between Workers (same account) = 4 deploys: source live -> target `"state": "expecting-transfer", "storage": "sqlite", "transfer_from": "<source>"` (no binding yet) -> source `"state": "transferred", "transferred_to": "<target>"` -> target adds binding + plain live entry.

## Code

```ts
import { DurableObject } from "cloudflare:workers";

export class MyDurableObject extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)",
		);
	}

	// Public methods are callable over RPC from a stub.
	async increment(by: number = 1): Promise<number> {
		const row = this.ctx.storage.sql
			.exec(
				"INSERT INTO counter (id, n) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET n = n + excluded.n RETURNING n",
				by,
			)
			.one();
		return Number(row.n);
	}

	async remindIn(ms: number): Promise<void> {
		await this.ctx.storage.setAlarm(Date.now() + ms); // one alarm per object; overrides any existing one
	}

	async alarm(alarmInfo?: { retryCount: number; isRetry: boolean }): Promise<void> {
		// at-least-once; a throw is retried with exponential backoff (2 s start, up to 6 retries)
	}
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const stub = env.MY_DURABLE_OBJECT.getByName(new URL(request.url).pathname);
		return Response.json({ n: await stub.increment() });
	},
} satisfies ExportedHandler<Env>;
```

Getting a stub (namespace API):

- `env.NS.getByName("name")` — recommended one-step form; optional `{ locationHint }`.
- `env.NS.idFromName(name)` / `env.NS.newUniqueId()` / `env.NS.idFromString(s)` then `env.NS.get(id, { locationHint: "enam" })`. `newUniqueId` gives lower first-use latency; store the ID string yourself.
- Jurisdiction: `const eu = env.NS.jurisdiction("eu"); const stub = eu.getByName("foo");` Values: `eu`, `us`, `fedramp`. Hard guarantee on where the object runs and stores data.
- Location hint (best effort, honored only on the first `get()` for that object): `wnam`, `enam`, `sam`, `weur`, `eeur`, `apac`, `apac-ne`, `apac-se`, `oc`, `afr`, `me`. `sam`, `afr`, `me` spawn in a nearby supported region. Objects do not move after creation.

SQL API: `ctx.storage.sql.exec(query, ...bindings)` returns a cursor: `.toArray()`, `.one()`, `.raw()`, `.columnNames`, `.rowsWritten`, iterable. Consume cursors synchronously before the next `await`. `sql.exec()` cannot run `BEGIN TRANSACTION` / `SAVEPOINT`; use `ctx.storage.transaction()` / `transactionSync()`. KV methods (`get`/`put`/`delete`/`list`) also work on SQLite classes. Point-in-time recovery covers the last 30 days.

Alarms: `ctx.storage.setAlarm(ms)`, `getAlarm()`, `deleteAlarm()`, handler `alarm(alarmInfo)`. For many schedules, store them in SQL and re-arm one alarm for the next due item.

WebSocket hibernation (object can be evicted from memory while sockets stay open):

```ts
async fetch(request: Request): Promise<Response> {
	const [client, server] = Object.values(new WebSocketPair());
	this.ctx.acceptWebSocket(server); // not server.accept()
	server.serializeAttachment({ userId: "u1" }); // max 16,384 bytes, survives hibernation
	return new Response(null, { status: 101, webSocket: client });
}
async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
	const state = ws.deserializeAttachment();
	for (const peer of this.ctx.getWebSockets()) peer.send(message);
}
async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {}
```

## Verify

- Local: `npx wrangler dev`, then `curl http://localhost:8787/room-1` twice; `n` increments per path and is independent across paths.
- Deploy output prints a `Durable Object exports reconciliation:` block (for example `Created: MyDurableObject`) when a lifecycle change was applied; it is omitted when nothing changed.
- A `Safe to remove from exports:` line lists stale tombstones you may delete from config.

## Gotchas

- `exports` and `migrations` in the same config are rejected. Once deployed with `exports`, stay on `exports`; deploying with neither reconciles against an empty config.
- `wrangler versions upload` fails fast when `exports` entries are present; gradual deployments are not supported for lifecycle changes; you cannot roll back across a lifecycle change.
- Storage backend is immutable (`storage_type_mismatch`). Changing it means delete + re-provision with full data loss.
- Deploy errors are per class, for example `provisioned_class_missing_from_config`, `config_export_not_in_code`, `orphaned_provisioned_namespace`, `tombstone_delete_class_still_in_code`, `tombstone_delete_blocked_by_external_bindings`, `free_tier_requires_sqlite`. Fix all in one round.
- The same name in different jurisdictions is a different object. A jurisdiction mismatch between namespace and ID throws.
- Calling `setAlarm()` in the constructor: check `getAlarm()` first, because the constructor runs before `alarm()` on wake-up.
- Alarms stop retrying after 6 failures: catch errors in `alarm()` and re-arm yourself if it must never be dropped.
- `webSocketMessage` is not called for control frames.
- Pending I/O keeps an object in memory (and billed for duration) for up to 15 minutes per operation.
- An overloaded object returns an `overloaded` error to callers; one object is single-threaded with a soft limit of 1,000 requests/second. Shard across objects.

## Limits and cost

| Item | Free | Paid |
| --- | --- | --- |
| Classes per account | 100 | 500 |
| Storage per account (SQLite) | 5 GB | Unlimited |
| Storage per object (SQLite) | 10 GB | 10 GB |
| CPU per request | 30 s default, configurable to 5 min | same |
| Requests | 100,000 / day | 1 M / month, then $0.15 / M |
| Duration | 13,000 GB-s / day | 400,000 GB-s / month, then $12.50 / M GB-s |
| SQL rows read | 5 M / day | 25 B / month, then $0.001 / M |
| SQL rows written | 100,000 / day | 50 M / month, then $1.00 / M |
| SQL stored data | 5 GB total | 5 GB-month, then $0.20 / GB-month |

- Key + value max 2 MB; row/string/BLOB max 2 MB; 100 columns per table; SQL statement max 100 KB; 100 bound parameters; received WebSocket message max 32 MiB.
- Requests include HTTP requests, RPC sessions (each stub method call = 1), alarm invocations, and incoming WebSocket messages at a 20:1 ratio. Each `setAlarm()` = 1 row written. Deletes count as rows written.
- Duration is not billed while an object is idle and eligible for hibernation. On Free, exceeding a daily limit makes further operations of that type fail; limits reset at 00:00 UTC.

## Sources

- https://developers.cloudflare.com/durable-objects/get-started/index.md
- https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/index.md
- https://developers.cloudflare.com/durable-objects/api/namespace/index.md
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/index.md
- https://developers.cloudflare.com/durable-objects/api/alarms/index.md
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/index.md
- https://developers.cloudflare.com/durable-objects/reference/data-location/index.md
- https://developers.cloudflare.com/durable-objects/platform/limits/index.md
- https://developers.cloudflare.com/durable-objects/platform/pricing/index.md
