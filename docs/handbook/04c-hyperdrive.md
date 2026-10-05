# Hyperdrive (connect a Worker to existing Postgres / MySQL)

> **Use when:** a Worker must query an existing Postgres or MySQL database (Neon, Supabase, RDS, PlanetScale, self-hosted, private network).
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

## Default path

1. Create the Hyperdrive config. Wrangler connects to the database to validate the credentials before it creates anything.

   The docs only document passing credentials as flags. To keep the password out of shell history and files, read it into a shell variable first (shell technique, not from the Cloudflare docs) and use the split flags:
   ```sh
   read -rs DB_PASSWORD        # type or paste the password; nothing is echoed or saved to history
   npx wrangler hyperdrive create my-hyperdrive \
     --origin-host db.example.com --origin-port 5432 \
     --database app --origin-user app_user --origin-password "$DB_PASSWORD" \
     --origin-scheme postgresql \
     --binding HYPERDRIVE --update-config
   unset DB_PASSWORD
   ```
   Single-string form (same effect). Keep the URL in an environment variable so it never lands in a file or in shell history:
   ```sh
   npx wrangler hyperdrive create my-hyperdrive --connection-string="$DATABASE_URL"
   ```
   `DATABASE_URL` is the database's standard connection URL: scheme `postgres` or `mysql`, then user, password, host, port (5432 or 3306) and database name.
   MySQL with split flags: `--origin-scheme mysql --origin-port 3306`. Never write the origin connection string into `wrangler.jsonc` or commit it.
2. Copy the `id` from the output into the binding (see **Config**) unless `--update-config` wrote it.
3. Install a driver.
   ```sh
   npm i pg && npm i -D @types/pg      # Postgres, recommended driver, 8.13.0 or later
   npm i "postgres@>3.4.5"             # Postgres.js alternative, minimum 3.4.5
   npm i "mysql2@>3.13.0"              # MySQL, minimum 3.13.0
   ```
4. Local dev: point the binding at a database with an environment variable (preferred, nothing committed), then run `wrangler dev`.
   ```sh
   export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$LOCAL_DATABASE_URL"   # connection URL of a local or dev database
   npx wrangler dev
   ```
   Variable name = `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING_NAME>`. It overrides `localConnectionString` in the config.
5. Deploy: `npx wrangler deploy`.

Manage configs:

```sh
npx wrangler hyperdrive list
npx wrangler hyperdrive get <ID>
npx wrangler hyperdrive update <ID> --origin-password "$NEW_PASSWORD"     # rotate credentials
npx wrangler hyperdrive update <ID> --max-age 30 --swr 5                   # tune cache
npx wrangler hyperdrive update <ID> --caching-disabled                     # turn cache off
npx wrangler hyperdrive update <ID> --origin-connection-limit 20           # soft cap on origin connections
```

**DESTRUCTIVE** `npx wrangler hyperdrive delete <ID>`: every Worker bound to it loses database access.

## Config

```jsonc
{
	"compatibility_flags": ["nodejs_compat"],
	"compatibility_date": "2026-10-05",
	"hyperdrive": [
		{
			"binding": "HYPERDRIVE",
			"id": "<HYPERDRIVE_ID>"
		}
	]
}
```

`nodejs_compat` is required for the database drivers. An optional `localConnectionString` key on the binding (a database connection URL) is used by local `wrangler dev` only; prefer the environment variable so no credential is committed.

## Code

Postgres with `pg` (recommended):

```ts
import { Client } from "pg";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// New client per request. Hyperdrive holds the real pool, so this is fast.
		const sql = new Client({ connectionString: env.HYPERDRIVE.connectionString });
		try {
			await sql.connect();
			const results = await sql.query("SELECT * FROM pg_tables");
			return Response.json(results.rows);
		} catch (e) {
			console.error(e);
			return Response.json({ error: e instanceof Error ? e.message : e }, { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
```

Postgres with Postgres.js:

```ts
import postgres from "postgres";

const sql = postgres(env.HYPERDRIVE.connectionString, {
	max: 5,               // Workers limit concurrent external connections
	fetch_types: false,   // skip a round trip if you use no array types
	prepare: true,        // keep true; `prepare: false` adds round trips and defeats caching
});
const rows = await sql`SELECT * FROM pg_tables`;
```

MySQL with `mysql2`:

```ts
import { createConnection } from "mysql2/promise";

const connection = await createConnection({
	host: env.HYPERDRIVE.host,
	user: env.HYPERDRIVE.user,
	password: env.HYPERDRIVE.password,
	database: env.HYPERDRIVE.database,
	port: env.HYPERDRIVE.port,
	disableEval: true,    // required for mysql2 on Workers
});
const [results, fields] = await connection.query("SHOW tables;");
```

Create clients inside the handler, never in global scope.

## Verify

```sh
npx wrangler hyperdrive get <ID>        # expect the config you created (UNVERIFIED: exact output fields)
npx wrangler dev                        # with the local connection string set; hit the route, expect rows
npx wrangler deploy && curl https://<worker>.<subdomain>.workers.dev/   # expect rows through Hyperdrive
```

A failed `hyperdrive create` means Hyperdrive could not reach or authenticate to the database: fix firewall / TLS / credentials before anything else.

## Gotchas

- Caching is ON by default: `max_age` 60 s, `stale_while_revalidate` 15 s, `max_age` capped at 1 hour. Hyperdrive does NOT invalidate cached reads when you write. For read-after-write (auth, sessions, permissions, balances) create a second config with `--caching-disabled`, bind it as e.g. `HYPERDRIVE_FRESH`, and route those reads through it.
- Only read queries with no volatile/stable functions are cached. `NOW()`, `CURRENT_TIMESTAMP`, `CURRENT_DATE`, `RANDOM()`, `LASTVAL()` (MySQL: `NOW()`, `LAST_INSERT_ID()`) make a query uncacheable, even when they appear only inside a SQL comment. Compute the value in the Worker and bind it as a parameter.
- Two queries that differ only in comment text share one cache entry. Do not use comments as cache control.
- Local `wrangler dev` connects straight to the database: no pooling, no caching. For a remote database in local dev add the TLS mode to the string (`?sslmode=require` for Postgres, `?sslMode=required` for MySQL).
- `wrangler dev --remote` runs on Cloudflare with the deployed config and ignores `localConnectionString`: writes hit production data.
- Several configs on one database share its connection budget. Add up `--origin-connection-limit` across configs.
- `Failed to acquire a connection from the pool.` = long transactions or queries holding connections. `Server connection attempt failed: connection_refused` = firewall or the provider's connection limit.
- Private database, recommended path (Workers VPC, no Access app or service token): run `cloudflared` in the network, then
  ```sh
  npx wrangler vpc service create my-postgres-db --type tcp --tcp-port 5432 --app-protocol postgresql \
    --tunnel-id <TUNNEL_ID> --ipv4 <DATABASE_IP>
  npx wrangler hyperdrive create my-hyperdrive --service-id <VPC_SERVICE_ID> \
    --database app --user app_user --password "$DB_PASSWORD" --scheme postgresql
  ```
  `--service-id` cannot be combined with `--origin-host`, `--origin-port`, `--connection-string`, `--access-client-id` or `--access-client-secret`. Needs the **Connectivity Directory Admin** role and a database configured for TLS. MySQL: `--tcp-port 3306 --app-protocol mysql`, `--scheme mysql`.
- Private database, older path (Tunnel public hostname + Access service token):
  `npx wrangler hyperdrive create <NAME> --host=<TUNNEL_HOSTNAME> --user=<USER> --password=<PASSWORD> --database=<DB> --access-client-id=<ID> --access-client-secret=<SECRET>`
- TLS flags: `--sslmode require|verify-ca|verify-full` (Postgres) or `REQUIRED|VERIFY_CA|VERIFY_IDENTITY` (MySQL), with `--ca-certificate-id` / `--mtls-certificate-id`.

## Limits and cost

| | Free | Paid |
| --- | --- | --- |
| Database queries through Hyperdrive | 100,000/day | Unlimited |
| Configured databases per account | 10 | 25 |
| Max origin connections per config | ~20 | ~100 |
| Initial connection timeout | 15 s | 15 s |
| Idle connection timeout | 10 min | 10 min |
| Max query duration | 60 s | 60 s |
| Max cached response size | 50 MB (larger responses are returned, not cached) | 50 MB |

Hyperdrive itself has no usage charge on Workers Paid: pooling and caching are included, no egress fee. Cached and uncached queries both count toward the Free daily limit, which resets at 00:00 UTC. Your database provider still bills you for the database.

## Sources
- https://developers.cloudflare.com/hyperdrive/get-started/
- https://developers.cloudflare.com/hyperdrive/reference/wrangler-commands/
- https://developers.cloudflare.com/hyperdrive/configuration/local-development/
- https://developers.cloudflare.com/hyperdrive/concepts/query-caching/
- https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/
- https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-mysql/mysql-drivers-and-libraries/mysql2/
- https://developers.cloudflare.com/hyperdrive/platform/limits/
- https://developers.cloudflare.com/hyperdrive/platform/pricing/
