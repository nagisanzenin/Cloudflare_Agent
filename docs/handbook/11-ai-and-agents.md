# AI and agents: Workers AI, AI Gateway, Agents SDK, MCP, Vectorize, AI Search

> **Use when:** a Worker must call an LLM (Cloudflare-hosted or third-party), run a stateful agent, expose an MCP server, or do vector / document search.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

## Default path

1. Model calls: add the `ai` binding and call `env.AI.run()`. One binding now covers Workers AI models and third-party models routed through AI Gateway (see **Code**).
2. Stateful agent: `npm i agents`, write an `Agent` subclass, add the Durable Object binding + SQLite migration, export the class, route with `routeAgentRequest`.
   New project instead: `npm create cloudflare@latest -- --template cloudflare/agents-starter`, then `npm run dev` / `npm run deploy`.
3. Remote MCP server: `npm i agents @modelcontextprotocol/server@2.0.0 zod` and use `createMcpHandler` from `agents/mcp/server` (stateless, Streamable HTTP). `McpAgent` is deprecated and feature-frozen: do not start new servers on it.
4. Vector search: create the index, bind it, insert, query.
   ```sh
   npx wrangler vectorize create my-index --dimensions=768 --metric=cosine
   npx wrangler vectorize create-metadata-index my-index --property-name=url --type=string   # only if you filter on metadata
   npx wrangler vectorize info my-index
   ```
   `--metric` accepts `euclidean`, `cosine` or `dot-product` (per `wrangler vectorize create --help` on 4.147.0).
5. `npx wrangler types` after every binding change, then `npx wrangler deploy`.

## Config

```jsonc
{
	"compatibility_date": "2026-10-05",
	"compatibility_flags": ["nodejs_compat"],          // required by the agents package
	"ai": { "binding": "AI" },
	"vectorize": [{ "binding": "VECTORIZE", "index_name": "my-index" }],
	"durable_objects": { "bindings": [{ "name": "CounterAgent", "class_name": "CounterAgent" }] },
	"migrations": [{ "tag": "v1", "new_sqlite_classes": ["CounterAgent"] }],
	"ai_search_namespaces": [{ "binding": "AI_SEARCH", "namespace": "default", "remote": true }]
}
```

`class_name` must match the exported class exactly. `name` becomes `env.<name>`. `new_sqlite_classes` gives the agent its SQLite storage. The Agents docs still show this legacy `migrations` form; a new Worker can declare the class in `exports` instead (`05-durable-objects.md`). Never use both in one config. Agents using `@callable()` need `tsconfig.json` with `{ "extends": "agents/tsconfig" }`; Vite projects also add the `agents()` plugin from `agents/vite`.

## Code

Workers AI and AI Gateway through one binding:

```ts
// Workers AI model: name starts with "@cf/<author>/<model>"
const a = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
	prompt: "What is Cloudflare?",          // chat models also accept messages: [{ role, content }]
});

// Streaming: add `stream: true`, return `new Response(result, { headers: { "content-type": "text/event-stream" } })`

// Same model, routed through an AI Gateway (logging, caching, rate limiting, fallback)
const b = await env.AI.run(
	"@cf/meta/llama-3.1-8b-instruct",
	{ prompt: "tell me a joke" },
	{ gateway: { id: "default", skipCache: true } },   // "default" is auto-created on first authenticated request
);

// Third-party model: "{author}/{model}". Requires a gateway; billed from prepaid credits (Unified Billing), no provider key needed.
const c = await env.AI.run(
	"openai/gpt-4.1-mini",
	{ messages: [{ role: "user", content: "tell me a joke" }] },
	{ gateway: { id: "default" } },
);
```

REST equivalent (OpenAI-compatible): `POST https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/v1/chat/completions` with `Authorization: Bearer $CLOUDFLARE_API_TOKEN`, header `cf-aig-gateway-id: default`, body `{"model": "@cf/...", "messages": [...]}`. Also `/ai/run` (all modalities) and `/ai/v1/responses`.

Token permissions: `AI Gateway - Read`, `AI Gateway - Edit`, `Workers AI - Read`. Workers AI models require the `cf-aig-gateway-id` header on this endpoint; third-party models fall back to the `default` gateway. Provider auth options: Unified Billing (prepaid credits), BYOK (keys stored in Cloudflare), or the provider key in request headers.

Agent (Agents SDK):

```ts
import { Agent, callable, routeAgentRequest, getAgentByName } from "agents";

type CounterState = { count: number };

export class CounterAgent extends Agent<Env, CounterState> {
	initialState: CounterState = { count: 0 };

	@callable()                                   // callable from clients over WebSocket RPC
	increment() {
		this.setState({ count: this.state.count + 1 });   // persisted in the agent's SQLite, synced to clients
		return this.state.count;
	}

	async onRequest(request: Request) {
		await this.schedule(30, "tick", { reason: "delay" });            // seconds from now
		await this.schedule(new Date("2026-12-01T09:00:00Z"), "tick", { reason: "date" });
		await this.schedule("0 8 * * *", "tick", { reason: "cron" });   // recurring
		await this.scheduleEvery(45, "tick", { reason: "interval" });   // every 45 s
		const rows = this.sql<{ id: string }>`SELECT 1 AS id`;           // embedded SQL, returns an array
		return Response.json({ state: this.state, rows });
	}

	async tick(payload: { reason: string }) {
		console.log("scheduled:", payload.reason);
	}

	onStateChanged(state: CounterState, source: unknown) {}
}

export default {
	async fetch(request, env, ctx) {
		// Routes /agents/{kebab-case-class}/{instance-name}, e.g. /agents/counter-agent/user-123
		const agentResponse = await routeAgentRequest(request, env);
		if (agentResponse) return agentResponse;
		// Or address an instance yourself:
		// const agent = await getAgentByName(env.CounterAgent, "user-123"); return agent.fetch(request);
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
```

Remote MCP server (stateless):

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer() {
	const server = new McpServer({ name: "hello-server", version: "1.0.0" });
	server.registerTool(
		"hello",
		{ description: "Return a greeting", inputSchema: { name: z.string().optional() } },
		async ({ name }) => ({ content: [{ type: "text", text: `Hello, ${name ?? "World"}!` }] }),
	);
	return server;
}

export default {
	fetch(request, env, ctx) {
		return createMcpHandler(createServer)(request, env, ctx);
	},
};
```

Vectorize:

```ts
await env.VECTORIZE.insert([{ id: "1", values: embedding, metadata: { url: "/products/sku/1" } }]); // upsert() overwrites
const matches = await env.VECTORIZE.query(queryVector, { topK: 3, returnValues: true, returnMetadata: "all" });
const vectors = await env.VECTORIZE.getByIds(["1"]);
await env.VECTORIZE.deleteByIds(["1"]);
```

AI Search (formerly AutoRAG; managed ingestion + retrieval, available on all plans): bind a namespace, create an instance, upload or connect data (R2 bucket, website crawl, built-in storage), search in natural language. It has no local emulation, so the binding needs `"remote": true` for `wrangler dev`.

```ts
const instance = await env.AI_SEARCH.create({ id: "my-instance" });
await instance.items.uploadAndPoll("getting-started.md", "AI Search indexes uploaded content for retrieval.");
const results = await env.AI_SEARCH.get("my-instance").search({
	messages: [{ role: "user", content: "What does AI Search do?" }],
	ai_search_options: { retrieval: { max_num_results: 3 } },
});
// results.chunks
```

## Verify

- Workers AI: `npx wrangler dev`, hit the route, expect a JSON `response`. **COST** Workers AI always runs on your account, including under local `wrangler dev`.
- Agent: `curl http://localhost:8787/agents/counter-agent/test` returns the `onRequest` JSON.
- MCP: `npx @modelcontextprotocol/inspector@latest`, connect to `http://localhost:8787/mcp` (use the port Wrangler prints; `createMcpHandler` serves the exact path `/mcp` by default, change it with the `route` option), **List Tools** shows `hello`. A browser GET of the endpoint does not work; it expects MCP protocol messages.
- Vectorize: `npx wrangler vectorize info my-index` shows the vector count rising a few seconds after an insert.

## Gotchas

- The old gateway URL `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat/chat/completions` is deprecated for single-model calls. Use `api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions` or the binding. It still works for existing integrations and dynamic routes.
- On the binding path only a BYOK key stored under the `default` alias is used; otherwise the request falls through to Unified Billing (prepaid credits).
- Dynamic routes: model `dynamic/{route}`, with `gateway.id` set to the gateway that owns the route; OpenAI chat-completions request shape only.
- Some `@cf/` models (for example `@cf/moonshotai/kimi-k2.6`, `@cf/zai-org/glm-5.3`) require a paid billing method and get 20 requests/min (50 with prepaid AI Gateway credits).
- MCP: `createMcpHandler` (import `agents/mcp/server`, package `@modelcontextprotocol/server`) is the path for new servers. `createLegacyMcpHandler` (import `agents/mcp`, package `@modelcontextprotocol/sdk@1.30.0`) is for existing sessionful routes. The quick-deploy templates (`cloudflare/ai/demos/remote-mcp-authless`) still use deprecated `McpAgent`; start from the `mcp-worker` example in `cloudflare/agents` instead. Pin the exact MCP package version your installed `agents` release requires.
- Agents: the class must be exported from the Worker entry point, and URLs use the kebab-case class name (`AIAssistant` -> `/agents/ai-assistant/...`).
- Vectorize inserts, upserts and deletes are asynchronous: they return a mutation id and take a few seconds to become queryable. Dimensions and metric are fixed at index creation.
- Vectorize `topK` max is 50 when returning values or metadata, 100 otherwise. Metadata filters need a metadata index created first.
- AI Gateway logs: accounts whose first gateway was created on or after 2026-09-24 follow Workers Logs pricing and retention.

## Limits and cost

| | Free | Workers Paid |
| --- | --- | --- |
| Workers AI | 10,000 Neurons/day, then requests fail | 10,000 Neurons/day included, then $0.011 per 1,000 Neurons |
| AI Gateway core (analytics, caching, rate limiting) | free | free |
| AI Gateway legacy logs (gateway created before 2026-09-24) | 100,000 logs total | 10,000,000 logs per gateway |
| Vectorize queried dimensions | 30 million/month | 50 million/month included, then $0.01/million |
| Vectorize stored dimensions | 5 million | 10 million included, then $0.05 per 100 million |
| Vectorize indexes per account | 100 | 50,000 |
| AI Search instances per account | 100 | 5,000 |

- Workers AI is GA. Pricing unit is the Neuron (model pages also list per-token prices). Default rate limits: text generation 300 requests/min, text embeddings 3,000 requests/min. Limits reset daily at 00:00 UTC.
- Vectorize is GA: max 1536 dimensions, 20,000,000 vectors per index, 10 KiB metadata per vector, 1,000 vectors per Worker upsert batch.
- AI Search billing begins 2026-11-01. Included per month: 5 million ingestion tokens, 10 GB-month storage, 1,000 semantic and 1,000 full-text queries. Then $0.75 per million ingestion tokens, $2.00/GB-month, $0.75 per 1,000 semantic/vector/hybrid queries, $0.10 per 1,000 full-text queries.
- Agents run on Durable Objects: Durable Objects pricing and limits apply (10 GB storage per agent instance).

## Sources
- https://developers.cloudflare.com/workers-ai/configuration/bindings/
- https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/platform/limits/
- https://developers.cloudflare.com/ai-gateway/
- https://developers.cloudflare.com/ai-gateway/get-started/
- https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/
- https://developers.cloudflare.com/ai-gateway/integrations/aig-workers-ai-binding/
- https://developers.cloudflare.com/ai-gateway/usage/chat-completion/
- https://developers.cloudflare.com/ai-gateway/reference/pricing/
- https://developers.cloudflare.com/agents/getting-started/add-to-existing-project/
- https://developers.cloudflare.com/agents/getting-started/quick-start/
- https://developers.cloudflare.com/agents/runtime/communication/routing/
- https://developers.cloudflare.com/agents/runtime/lifecycle/state/
- https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/
- https://developers.cloudflare.com/agents/runtime/execution/schedule-tasks/
- https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/
- https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/
- https://developers.cloudflare.com/vectorize/get-started/intro/
- https://developers.cloudflare.com/vectorize/reference/client-api/
- https://developers.cloudflare.com/vectorize/platform/limits/
- https://developers.cloudflare.com/vectorize/platform/pricing/
- https://developers.cloudflare.com/ai-search/
- https://developers.cloudflare.com/ai-search/get-started/workers/
- https://developers.cloudflare.com/ai-search/platform/limits-pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
