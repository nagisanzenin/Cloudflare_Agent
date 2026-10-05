# Dynamic Workers (Worker Loader)

> **Use when:** you must run JavaScript/Python/Wasm supplied at runtime (agent "code mode", user plugins, generated apps) in a fresh isolate, and the code only needs methods and data you hand it, not a Linux environment.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

Status: available on the **Workers Paid plan only**. The doc pages fetched today carry no beta label; "Dynamic Workers created daily" has been billed since 2026-05-26.

## Default path

1. Add the Worker Loader binding (Config). It points at no external resource; it only exposes the loader API on `env.LOADER`.
2. In the parent ("loader") Worker call `env.LOADER.load(code)` (fresh isolate each call) or `env.LOADER.get(id, callback)` (may reuse a warm isolate for the same `id`).
3. Lock it down: `globalOutbound: null` blocks all `fetch()`/`connect()`; pass only the capabilities you choose through `env`.
4. `npx wrangler types`, `npx wrangler dev`, then `npx wrangler deploy` **COST**.
5. Starter: https://github.com/cloudflare/agents/tree/main/examples/dynamic-workers

## Config

```jsonc
{
	"worker_loaders": [
		{ "binding": "LOADER" }
	]
}
```

## Code

```ts
import { WorkerEntrypoint } from "cloudflare:workers";

// Capability handed to the untrusted code. Runs in the loader Worker; props never reach the Dynamic Worker.
export class Greeter extends WorkerEntrypoint<Env, { tenant: string }> {
	async greet(name: string): Promise<string> {
		return `Hello ${name} from ${this.ctx.props.tenant}`;
	}
}

// Optional egress gateway: every fetch()/connect() of the Dynamic Worker arrives here.
export class HttpGateway extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.hostname !== "api.example.com") return new Response("blocked", { status: 403 });
		const headers = new Headers(request.headers);
		headers.set("Authorization", `Bearer ${this.env.API_TOKEN}`); // secret stays in the loader
		return fetch(request, { headers });
	}
}

const untrusted = `
	export default {
		async fetch(request, env) {
			return new Response(await env.GREETER.greet("world"));
		},
	};
`;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const worker = env.LOADER.load({
			compatibilityDate: "2026-10-05",
			mainModule: "index.js",
			modules: { "index.js": untrusted },
			env: { GREETER: ctx.exports.Greeter({ props: { tenant: "acme" } }) },
			globalOutbound: null, // or: ctx.exports.HttpGateway
			limits: { cpuMs: 10, subRequests: 5 },
		});
		return worker.getEntrypoint().fetch(request);
	},
};
```

Reuse a warm isolate (and pay for one creation per ID + code version per day):

```ts
const worker = env.LOADER.get("hello-v1", async () => ({
	compatibilityDate: "2026-10-05",
	mainModule: "index.js",
	modules: { "index.js": await env.MY_CODE_STORAGE.get("hello-v1") },
	globalOutbound: null,
}));
```

API facts:

- `load(code: WorkerCode): WorkerStub`; `get(id: string, cb: () => Promise<WorkerCode>): WorkerStub`. Both return synchronously; requests wait for loading.
- `WorkerCode`: `compatibilityDate`, `compatibilityFlags?`, `allowExperimental?`, `mainModule`, `modules`, `globalOutbound?`, `env`, `tails?`, `limits?`.
- `modules` values: a string (JS or Python source) or `{js}`, `{cjs}`, `{py}`, `{text}`, `{data: ArrayBuffer}`, `{wasm: ArrayBuffer}`, `{json: object}`.
- `worker.getEntrypoint()` = default export; `worker.getEntrypoint<T>("Name")` = named `WorkerEntrypoint` (call its RPC methods); `worker.getEntrypoint(null, { limits: { cpuMs, subRequests } })` sets per-call limits (lower of the two wins).
- `env` accepts structured-cloneable values and service bindings, including loopback stubs from `ctx.exports.<Class>({ props })`.
- `tails: [ctx.exports.LogTailer({ props })]` attaches Tail Workers for logs/errors per run.
- TypeScript / npm deps: no build step in the loader. Bundle first, for example `import { createWorker } from "@cloudflare/worker-bundler"` then `const { mainModule, modules } = await createWorker({ files })`.
- Python: add `compatibilityFlags: ["python_workers"]`.
- Related pages (not expanded here): Durable Object facets (per-app storage), Dynamic Workflows, static assets, observability.

## Verify

- `npx wrangler dev`, then `curl http://localhost:8787/` returns `Hello world from acme`.
- Change the untrusted code to `await fetch("https://example.com")` with `globalOutbound: null`: the call throws inside the Dynamic Worker (request fails) — proof that egress is blocked.
- Billable count: dashboard -> Workers & Pages -> Overview, or GraphQL `workersInvocationsByOwnerAndScriptGroups { uniq { distinctDynamicWorkerCount } }`.

## Gotchas

- **Default egress is open:** if `globalOutbound` is omitted, the Dynamic Worker inherits the parent's network access (normally the full Internet). Always set it for untrusted code.
- A Dynamic Worker does not inherit the parent's bindings, secrets or data; it sees only what you put in `env`.
- `get()`: the callback must return identical content for the same `id`; change the code -> change the `id` (for example `<name>:<version>` or a content hash). Caching is best effort; two requests may hit different isolates, and the callback may run more than once.
- `load()` (or no ID) counts as one billable Dynamic Worker **per invocation**; use `get()` with a stable ID for repeated code.
- Docs samples show `compatibilityDate: "$today"` — an unrendered docs placeholder; pass a real date string.
- Hitting a custom `cpuMs` / `subRequests` limit throws immediately.
- A Dynamic Worker cannot start child processes or load native add-ons, and Node.js APIs are only partly implemented: use a Container for that (`07-containers-sandbox.md`).

## Limits and cost

| Item | Value |
| --- | --- |
| Plan | Workers Paid only |
| Distinct Dynamic Workers with in-flight requests, per Worker request | 4 |
| Same, per Durable Object (shared across its concurrent requests) | 10 |
| CPU time / subrequests per invocation | Workers plan limits by default; lower them with `limits` |
| Dynamic Workers created daily | 1,000 unique / month included, then $0.002 per Dynamic Worker per day |
| Requests | 10 M / month included, then $0.30 / M (Workers Standard, on the Workers bill) |
| CPU time | 30 M CPU-ms / month included, then $0.02 / M CPU-ms (Workers Standard) |

Uniqueness = Worker ID + code: same ID and code invoked many times in a day = 1; same code under different IDs = 1 per ID; same ID with new code = 1 per code version.

## When to choose what

| Need | Use |
| --- | --- |
| Generated JS/Python that only calls typed methods you expose; millisecond start; thousands of short runs | Dynamic Worker |
| `npm test`, compilers, native binaries, child processes, a dev/preview server on a port, arbitrary languages | Container / sandbox (`durable_object` policy) |
| Both (agent answers questions via scoped methods, then runs the repo's tests) | Dynamic Worker + Container from the same Worker |

Isolation: Dynamic Workers run in V8 isolates plus the Workers process-level sandbox; Containers run in a Firecracker microVM with their own kernel and network.

## `@cloudflare/computer`

The Cloudflare blog (2026-09-30) names `@cloudflare/computer` only in one sentence: a higher-level environment that "combines Dynamic Workers and Containers with a synchronized filesystem". No API reference was found in the developer docs indexes today. UNVERIFIED: its API, config and install steps — do not generate code against it without reading its current README.

## Sources

- https://developers.cloudflare.com/dynamic-workers/index.md
- https://developers.cloudflare.com/dynamic-workers/getting-started/index.md
- https://developers.cloudflare.com/dynamic-workers/api-reference/index.md
- https://developers.cloudflare.com/dynamic-workers/usage/bindings/index.md
- https://developers.cloudflare.com/dynamic-workers/usage/egress-control/index.md
- https://developers.cloudflare.com/dynamic-workers/usage/limits/index.md
- https://developers.cloudflare.com/dynamic-workers/platform/limits/index.md
- https://developers.cloudflare.com/dynamic-workers/pricing/index.md
- https://developers.cloudflare.com/sandbox/index.md
- https://developers.cloudflare.com/sandbox/concepts/index.md
- https://blog.cloudflare.com/faster-agent-sandboxes/
