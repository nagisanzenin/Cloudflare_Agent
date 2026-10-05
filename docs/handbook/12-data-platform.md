# Data platform: Basin (analytics) and K2 (event streams)

> **Use when:** you must ingest high-volume events, keep them as queryable analytics tables, or fan one event log out to several consumers; and D1 or Queues is the wrong shape.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

## Default path

Pick first:

| Need | Use |
| --- | --- |
| Transactional app data, point lookups, small relational sets | D1 (`04b-d1.md`) |
| One unit of work per message, per-message retries, delays, dead-letter queues | Queues |
| Events that should end up in R2 as Iceberg tables / Parquet / JSON and be queried with SQL (OLAP) | Basin |
| A durable ordered log, replay within retention, several independent consumers, custom processing or non-R2 destinations | K2 |

**Basin** (GA 2026-10-01; requires Workers Paid and R2). Basin is the new name of the Cloudflare Data Platform: Cloudflare Pipelines -> **Basin Pipelines**, R2 Data Catalog -> **Basin Catalog**, R2 SQL -> **Basin SQL**. Existing resources, configs and APIs keep working; the old R2 Data Catalog / R2 SQL APIs are slated for deprecation.

1. Create an R2 Account API token with **Admin Read & Write** (dashboard > **R2 object storage** > **Overview** > **Manage API tokens**). Setup asks for it, and Basin SQL uses the same token. Keep it out of the Worker and out of `wrangler.jsonc`.
2. Create stream + sink + pipeline (interactive). **COST**
   ```sh
   npx wrangler basin pipelines setup --name request_events
   ```
   In the prompts: turn the HTTP endpoint off if only a Worker sends events; define the schema; choose **Data Catalog (Iceberg)**, an R2 bucket name, namespace `default`, a table name; paste the R2 token; pick the roll interval (the guide uses 60 seconds); choose **Simple ingestion** for the SQL.
3. Get the stream ID and add the binding (see **Config**).
   ```sh
   npx wrangler basin pipelines streams list
   ```
4. Send events from the Worker (see **Code**), then `npx wrangler deploy`.
5. Query. **COST** (billed on compressed data scanned, 10 MB minimum per query)
   ```sh
   npx wrangler basin catalog get <YOUR_BUCKET>          # prints the warehouse name
   export WRANGLER_BASIN_SQL_AUTH_TOKEN="<R2_ACCOUNT_API_TOKEN>"
   npx wrangler basin sql query "<WAREHOUSE_NAME>" "SELECT path, COUNT(*) AS requests FROM default.request_events GROUP BY path ORDER BY requests DESC"
   ```

To put a catalog on an existing bucket without a pipeline: `npx wrangler basin catalog enable <YOUR_BUCKET_NAME>`. It exposes a standard Iceberg REST catalog, so Spark, Trino, Snowflake, DuckDB and other Iceberg engines can read the same tables.

**K2** (public beta; Workers Paid only). The docs give API calls only; there is no documented Wrangler command for K2.

1. Create an account API token with **K2 Config Write**, **K2 Produce**, **K2 Consume**. Export it; do not paste it into commands.
   ```sh
   export ACCOUNT_ID=<YOUR_ACCOUNT_ID>
   export CLOUDFLARE_API_TOKEN=<YOUR_API_TOKEN>
   ```
2. Create a stream.
   ```sh
   curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/k2/streams" \
     --request POST \
     --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     --header "Content-Type: application/json" \
     --data '{"name": "orders", "http": {"enabled": true, "authentication": true}, "retention_seconds": 604800}'
   export STREAM_ID=<result.id>
   export K2_ENDPOINT=https://$STREAM_ID.k2.cloudflarestorage.com
   ```
3. Produce from a Worker binding (see **Config** / **Code**) or over HTTP (`content` is standard base64):
   ```sh
   curl "$K2_ENDPOINT/produce" --request POST \
     --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" --header "Content-Type: application/json" \
     --data '{"records": [{"content": "eyJvcmRlcl9pZCI6MTAwMX0=", "headers": {"event-type": "order.created"}}]}'
   ```
4. Consume: create a subscription, lease a batch, process, acknowledge.
   ```sh
   curl "$K2_ENDPOINT/subscriptions" --request POST \
     --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" --header "Content-Type: application/json" \
     --data '{"name": "orders-processor", "start_at": {"type": "earliest"}}'          # or "latest"
   curl "$K2_ENDPOINT/subscriptions/$SUBSCRIPTION_ID/consume" --request POST \
     --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" --header "Content-Type: application/json" \
     --data '{"worker_id": "worker-1", "max_records": 100}'                          # returns batch_id, leased_until_ms, records
   curl "$K2_ENDPOINT/subscriptions/$SUBSCRIPTION_ID/batches/$BATCH_ID/ack" --request POST \
     --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" --header "Content-Type: application/json" \
     --data '{"worker_id": "worker-1"}'
   ```
   Also available: `.../batches/$BATCH_ID/extend` (longer lease) and `.../batches/$BATCH_ID/nack`.

## Config

```jsonc
{
	"pipelines": [
		{ "binding": "EVENTS", "stream": "<BASIN_STREAM_ID>" }
	],
	"k2": [
		{ "binding": "ORDERS", "stream": "<K2_STREAM_ID>" }
	]
}
```

The Basin binding key is still `pipelines`. The K2 `stream` is the 32-character lowercase hex stream ID, in the same account as the Worker; deploy validates it (errors `10399` malformed ID, `10400` stream not found, `10401` no permission, `10402` validation failed, retry).

## Code

```ts
export default {
	async fetch(request, env): Promise<Response> {
		// Basin Pipelines: array of JSON objects matching the stream schema. The binding handles auth.
		await env.EVENTS.send([{ path: new URL(request.url).pathname }]);

		// K2: content must be ArrayBuffer or Uint8Array (one type per batch). A batch is atomic.
		const encoder = new TextEncoder();
		const result = await env.ORDERS.send([
			{
				content: encoder.encode(JSON.stringify({ order_id: 1001, status: "created" })),
				headers: { "event-type": "order.created" },
			},
		]);
		if (!result.success) {
			console.error(`Produce failed: ${result.error.message}`);
			return new Response("Failed to record event", { status: result.error.retryable ? 503 : 500 });
		}
		return new Response("Event recorded");
	},
} satisfies ExportedHandler<Env>;
```

Run `npx wrangler types` after adding either binding.

## Verify

- Basin: `npx wrangler basin pipelines streams list` shows the stream; after sending events, the `basin sql query` above returns rows. An empty or missing table right after the first events is normal: wait a few minutes for the first file to roll, then re-run.
- K2: the produce call returns `{ "success": true }`; the consume call returns the records with base64 `content` (`| jq` and `base64 -d` to read them); the ack returns `"success": true`.

## Gotchas

- K2 is at-least-once: a batch not acknowledged before `leased_until_ms` (lease = 5 minutes) is delivered again. An ack after the lease expired and the batch was re-delivered has no effect. Make consumers idempotent.
- K2 does not deduplicate. Retry a failed produce only when `error.retryable` is `true`, and expect possible duplicates.
- K2 consumption is pull over HTTP. Push-based Worker consumers and key-based ordering are on the roadmap, not available. Do not design around them.
- K2 trades latency for throughput: batches in, batches out, no per-message retry, delay or dead-letter queue. That is Queues' job.
- A K2 stream created with `http.authentication` omitted accepts produce requests from anyone who has the endpoint URL. Never put an API token in browser code.
- Basin is for analytics (OLAP), not serving: data becomes queryable only after a file rolls (interval and file size are set at setup), and each SQL query bills at least 10 MB scanned.
- Basin sink billing uses UNCOMPRESSED bytes delivered; Basin SQL billing uses COMPRESSED bytes scanned. R2 storage and operations are billed on top.
- The blog shows `cf k2 streams create --name app_events --http-enabled` and `npx wrangler basin catalog create CATALOG_NAME`. UNVERIFIED: neither appears in the developer docs fetched today; prefer the API call and `basin catalog enable`.

## Limits and cost

Basin (Workers Paid; monthly included usage, then the rate):

| Dimension | Included / month | Then |
| --- | --- | --- |
| Pipelines stream ingress | unlimited | free |
| Pipelines SQL transforms | 50 GB | $0.04/GB |
| Pipelines sink delivery | 50 GB shared | $0.03/GB JSON, $0.06/GB Parquet or Iceberg |
| Catalog operations | 1 million | $9 per million |
| Catalog compaction (only if enabled) | 10 GB and 1 million objects | $0.005/GB and $2 per million objects |
| SQL compressed data scanned | 10 GB | $0.0025/GB ($2.50/TB) |

Failed queries and `EXPLAIN` / `SHOW` / `DESCRIBE` incur no scan charge. A Pipelines stream ingests up to 1 GB/s (raised from 5 MB/s on 2026-10-01).

K2 (public beta, not available on Workers Free):

| | Limit |
| --- | --- |
| Storage per account (beta) | 10 GB across all streams |
| Streams per account | 20 |
| Retention | 1 hour to 30 days, default 7 days |
| Produce request / record size | 5 MB / ~1 MB |
| Produce rate per stream (blog) | 30 MB/s |
| Consume | up to 10,000 records or 10 MB per request |
| Subscriptions per stream / active leases per subscription | 100 / 128 |

K2 is not billed during the beta. Anticipated pricing per the launch blog: $0.04/GB produced, $0.04/GB consumed, $0.02/GB-month retained.

## Sources
- https://developers.cloudflare.com/basin/
- https://developers.cloudflare.com/basin/get-started/guide/
- https://developers.cloudflare.com/basin/platform/pricing/
- https://developers.cloudflare.com/basin-pipelines/
- https://developers.cloudflare.com/basin-catalog/
- https://developers.cloudflare.com/basin-sql/
- https://blog.cloudflare.com/cloudflare-basin/
- https://developers.cloudflare.com/k2/
- https://developers.cloudflare.com/k2/get-started/
- https://developers.cloudflare.com/k2/concepts/
- https://developers.cloudflare.com/k2/features/produce/
- https://developers.cloudflare.com/k2/features/consume/
- https://developers.cloudflare.com/k2/platform/limits/
- https://blog.cloudflare.com/cloudflare-k2-streams/
- https://developers.cloudflare.com/workers/platform/storage-options/
