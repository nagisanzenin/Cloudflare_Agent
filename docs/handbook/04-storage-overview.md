# Storage overview: pick a store, then KV and R2

> **Use when:** a Worker needs to persist or read data and you must choose the product, or you are wiring up KV or R2.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

## Default path

1. Pick the store from this table. Do not default to KV for anything that needs read-after-write.

| Product | Data shape | Consistency | Hard size limits | Pick when |
| --- | --- | --- | --- | --- |
| Workers KV | key -> value blob | Eventual (other locations may lag 60 s or more) | key 512 B, value 25 MiB, metadata 1024 B | Read-heavy config, sessions, routing data, cache; at most 1 write/s per key |
| D1 (`04b-d1.md`) | SQLite tables | Single primary; replicas via Sessions API (sequential consistency) | 10 GB per database (cannot be raised), row/BLOB 2 MB | Relational app data, ad-hoc SQL, read-heavy |
| R2 | objects (blobs) | Strong per object | 5 TiB per object, key 1,024 B | Files, uploads, media, datasets, logs; zero egress |
| Durable Object storage | per-object KV + SQLite | Strong, transactional, single-threaded per object | 10 GB per object, key+value 2 MB | Coordination, per-user/per-tenant state, WebSockets, atomic ops |
| Hyperdrive (`04c-hyperdrive.md`) | your existing Postgres/MySQL | Your database's (cached reads may be stale up to `max_age`) | 60 s query, 50 MB cached response | An existing or large (>10 GB) Postgres/MySQL database |
| Vectorize (`11-ai-and-agents.md`) | vectors + metadata | Async writes (visible after a few seconds) | 1536 dims, 20,000,000 vectors/index | Embedding similarity search |

2. KV: create the namespace (the argument is a binding name; Wrangler prints the config block).
   ```sh
   npx wrangler kv namespace create MY_KV
   ```
3. R2: create the bucket.
   ```sh
   npx wrangler r2 bucket create my-bucket
   npx wrangler r2 bucket list
   ```
4. Paste the bindings from **Config**, run `npx wrangler types`, then `npx wrangler deploy`.

## Config

```jsonc
{
	"kv_namespaces": [{ "binding": "MY_KV", "id": "<NAMESPACE_ID>" }],
	"r2_buckets": [{ "binding": "MY_BUCKET", "bucket_name": "my-bucket" }]
}
```

`wrangler dev` uses local KV/R2 simulations by default. Set `"remote": true` on a KV binding to hit the real namespace from `wrangler dev`.

## Code

KV:

```ts
// get(key, type | { type, cacheTtl }) -> value | null. type: "text" (default) | "json" | "arrayBuffer" | "stream"
const cfg = await env.MY_KV.get("config", { type: "json", cacheTtl: 300 }); // cacheTtl min 30 s, default 60
const many = await env.MY_KV.get(["a", "b"]);               // Map; max 100 keys; counts as 1 operation
const { value, metadata } = await env.MY_KV.getWithMetadata("config");

// put(key, value, { expiration, expirationTtl, metadata }); value: string | ReadableStream | ArrayBuffer
await env.MY_KV.put("session:1", "data", {
	expirationTtl: 3600,            // seconds from now, minimum 60
	metadata: { user: "u1" },       // JSON, max 1024 bytes
});

// list({ prefix, limit, cursor }) -> { keys, list_complete, cursor }; max 1,000 keys per call
let cursor: string | undefined;
do {
	const page = await env.MY_KV.list({ prefix: "session:", cursor });
	for (const k of page.keys) console.log(k.name, k.expiration, k.metadata);
	cursor = page.list_complete ? undefined : page.cursor;
} while (cursor);

await env.MY_KV.delete("session:1");
```

R2 (Workers binding):

```ts
// put(key, value, options) -> R2Object; value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null
await env.MY_BUCKET.put(key, request.body, {
	httpMetadata: { contentType: "image/png" },
	customMetadata: { owner: "u1" },
});

const obj = await env.MY_BUCKET.get(key);          // R2ObjectBody | null; options: onlyIf, range
if (obj === null) return new Response("Not found", { status: 404 });
const headers = new Headers();
obj.writeHttpMetadata(headers);
headers.set("etag", obj.httpEtag);
return new Response(obj.body, { headers });

const meta = await env.MY_BUCKET.head(key);        // R2Object | null, no body
const page = await env.MY_BUCKET.list({ prefix: "img/", limit: 1000, cursor: undefined, delimiter: "/" });
// page.objects, page.truncated, page.cursor, page.delimitedPrefixes
await env.MY_BUCKET.delete([key1, key2]);          // up to 1000 keys per call
```

R2 over the S3-compatible API (outside Workers, or for presigned URLs):

```ts
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const S3 = new S3Client({
	region: "auto",                                              // required by the SDK, unused by R2
	endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
});
const getUrl = await getSignedUrl(S3, new GetObjectCommand({ Bucket: "my-bucket", Key: "image.png" }), { expiresIn: 3600 });
const putUrl = await getSignedUrl(S3, new PutObjectCommand({ Bucket: "my-bucket", Key: "image.png", ContentType: "image/png" }), { expiresIn: 3600 });
```

- S3 credentials: dashboard > **Storage & databases > R2 > Overview > Manage** (API Tokens) > **Create Account API token** (or User API token) > permission **Object Read & Write**, scoped to specific buckets. Copy the Access Key ID and Secret Access Key; the secret is shown once. Store them as Worker secrets, never in `wrangler.jsonc`.
- Presigned URLs: operations GET, PUT, HEAD, DELETE; expiry 1 second to 7 days (604,800 s); generated locally with no call to R2.

Public access:

```sh
npx wrangler r2 bucket dev-url enable my-bucket                                   # r2.dev URL: rate-limited, non-production only
npx wrangler r2 bucket domain add my-bucket --domain assets.example.com --zone-id <ZONE_ID>   # production
```

Both commands make every object in the bucket publicly readable. Confirm with the owner first.

## Verify

```sh
npx wrangler kv key put --binding=MY_KV "probe" "ok" --remote
npx wrangler kv key get --binding=MY_KV "probe" --text --remote      # expect: ok
npx wrangler kv key list --binding=MY_KV --remote
npx wrangler r2 object put my-bucket/probe.txt --file ./probe.txt --remote
npx wrangler r2 object get my-bucket/probe.txt --remote
```

- **COST** every KV operation from Wrangler or the dashboard is billed like a Worker operation, including reads of missing keys.
- **DESTRUCTIVE** `npx wrangler kv key delete`, `npx wrangler kv namespace delete`, `npx wrangler r2 object delete`, `npx wrangler r2 bucket delete`.

## Gotchas

- `wrangler kv key put|get|list|delete` act on LOCAL storage by default. Add `--remote` to touch the real namespace. `wrangler r2 object` has the same `--local` / `--remote` pair; pass one explicitly.
- KV is eventually consistent: a write is usually visible at once in the location that made it, and can take 60 seconds or more (or the reader's `cacheTtl`) elsewhere. Negative lookups are cached too, so a newly created key can read as `null` for the same window.
- KV has no atomic or transactional operations. Concurrent writes to one key: last write wins. More than 1 write/s to the same key throws `429`. Use a Durable Object for counters, locks and read-after-write.
- KV `expiration` wins over `cacheTtl`. Expiration targets less than 60 seconds in the future are rejected.
- KV bulk write (up to 10,000 pairs, request under 100 MB) exists only in Wrangler and the REST API, not on the binding.
- R2 `list()` may return fewer than `limit` objects. Loop on `truncated`, not on the count.
- R2 presigned URLs work only on `<ACCOUNT_ID>.r2.cloudflarestorage.com`, not on custom domains. For authenticated access on a custom domain use WAF HMAC validation (Pro plan or above).
- Do not CNAME to an `r2.dev` URL: unsupported. `r2.dev` is throttled at hundreds of requests/second (`429`). Disable `r2.dev` when you protect a custom domain with WAF or Access, or the bucket stays public.
- More than 1 concurrent write/s to the same R2 key returns `429`.
- KV Instant (announced 2026-10-01, **private beta**, sign-up required, not in the developer docs yet). Per the blog: a namespace created with `"mode": "instant"`, same binding API, about 250 ms global replication. Differences: no metadata (`getWithMetadata` returns `null`), `list` is unpaginated, max 10,000 pairs and 1 MB per namespace, key max 300 bytes, 1 write/s per namespace. Pricing: reads $0.20/million, each put/delete/list **$0.10 per operation**, storage **$100 per MB-month**. Never use it as a general KV replacement.

## Limits and cost

KV:

| | Free | Paid |
| --- | --- | --- |
| Reads | 100,000/day | 10 million/month included, then $0.50/million |
| Writes, deletes, lists (each) | 1,000/day | 1 million/month included, then $5.00/million |
| Storage | 1 GB | 1 GB included, then $0.50/GB-month |
| Namespaces per account | 1,000 | 1,000 |
| Operations per Worker invocation | 1,000 | 1,000 |

Free limits reset daily at 00:00 UTC; past them, operations of that type fail. No egress charge.

R2 (no Free vs Paid split; usage-based with a monthly free tier on Standard storage only):

| | Standard | Infrequent Access | Free tier / month |
| --- | --- | --- | --- |
| Storage | $0.015/GB-month | $0.01/GB-month (30-day minimum) | 10 GB-month |
| Class A ops (put, list, copy, multipart) | $4.50/million | $9.00/million | 1 million |
| Class B ops (get, head) | $0.36/million | $0.90/million | 10 million |
| Data retrieval | none | $0.01/GB | - |
| Egress | free | free | free |

`DeleteObject`, `DeleteBucket` and `AbortMultipartUpload` are free. Usage is rounded up to the next billing unit. Limits: 1,000,000 buckets/account, object 5 TiB (4.995 TiB effective), single-part upload 5 GiB (4.995 GiB effective), 10,000 multipart parts, metadata 8,192 bytes, 100 custom domains/bucket.

## Sources
- https://developers.cloudflare.com/workers/platform/storage-options/
- https://developers.cloudflare.com/kv/get-started/
- https://developers.cloudflare.com/kv/api/read-key-value-pairs/
- https://developers.cloudflare.com/kv/api/write-key-value-pairs/
- https://developers.cloudflare.com/kv/api/list-keys/
- https://developers.cloudflare.com/kv/api/delete-key-value-pairs/
- https://developers.cloudflare.com/kv/concepts/how-kv-works/
- https://developers.cloudflare.com/kv/platform/limits/
- https://developers.cloudflare.com/kv/platform/pricing/
- https://developers.cloudflare.com/kv/reference/kv-commands/
- https://blog.cloudflare.com/workers-kv-instant/
- https://developers.cloudflare.com/r2/get-started/workers-api/
- https://developers.cloudflare.com/r2/get-started/s3/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- https://developers.cloudflare.com/r2/buckets/public-buckets/
- https://developers.cloudflare.com/r2/reference/wrangler-commands/
- https://developers.cloudflare.com/r2/platform/limits/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
