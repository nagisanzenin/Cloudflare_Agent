# Containers and Sandboxes

> **Use when:** the code needs a real Linux environment (any language, child processes, native binaries, a long-running server) that a Worker isolate cannot provide; or you must run untrusted/agent-written commands in an isolated microVM.
> **Verified:** 2026-10-05 against the sources at the bottom. Re-verify anything older than 90 days.

Status: Containers and the Sandbox SDK are generally available on the Workers Paid plan (changelog 2026-04-13); the pricing table lists Free as N/A. The `durable_object` scheduling policy and filesystem snapshots are **public beta** (blog 2026-09-30 + docs). Every container instance is controlled by its own Durable Object and runs in a Firecracker microVM; image must be `linux/amd64`.

Two modes, chosen per `containers[]` entry and **immutable** afterwards:

| `scheduling_policy` | Image + instance size set in | Use the | Best for |
| --- | --- | --- | --- |
| `default` (when omitted) | `wrangler.jsonc`, rolled out app-wide | `Container` class from `@cloudflare/containers` | Services where every instance is the same |
| `durable_object` (beta) | code, at `ctx.container.start()` | plain `DurableObject` + `this.ctx.container` | Sandboxes, agent workspaces, snapshots |

## Default path

Service container (`default` policy):

1. Start Docker locally (`docker info` must succeed). Required for `wrangler dev` and `wrangler deploy`.
2. `npm create cloudflare@latest -- --template=cloudflare/templates/containers-template` (or add Config + Code below and `npm i @cloudflare/containers`).
3. `npx wrangler dev` (builds the image locally; press `r` to rebuild after Dockerfile/container code changes).
4. `npx wrangler deploy` **COST** — uploads the Worker, builds the image with Docker, pushes it to the Cloudflare Registry, rolls instances. Wait several minutes after the first deploy before container requests succeed.
5. `npx wrangler containers list` and `npx wrangler containers images list`.

Sandbox (`durable_object` policy, no Dockerfile needed):

1. `npm create cloudflare@latest -- sandbox-linux --category=hello-world --type=hello-world --lang=ts --no-deploy --no-git --no-agents`
2. Replace `wrangler.jsonc` and `src/index.ts` with the sandbox Config + Code below; `npx wrangler types`.
3. `npx wrangler dev` (Docker running; Wrangler >= 4.136.0 for this policy, >= 4.141.0 to run `cloudflare/debian-trixie` locally).
4. `npx wrangler deploy` **COST**. A deploy does not replace running instances under this policy.

Images: `image` may be a Dockerfile path, a directory, or a registry reference. Push a prebuilt image: `npx wrangler containers build -p -t <TAG> .` or `npx wrangler containers push <IMAGE>:<TAG>`. Private Docker Hub / ECR / Google Artifact Registry (default policy only): `npx wrangler containers registries configure <registry> ...`. Free registry space: `npx wrangler containers images delete` **DESTRUCTIVE** (rolling back to a Worker version that used the image then fails). `npx wrangler containers delete <APPLICATION_ID>` **DESTRUCTIVE** (deleting an application also deletes its instances).

## Config

Service container (`default` policy):

```jsonc
{
	"containers": [
		{
			"class_name": "MyContainer",
			"image": "./Dockerfile",
			"instance_type": "standard-1",   // optional
			"max_instances": 10
		}
	],
	"durable_objects": {
		"bindings": [{ "name": "MY_CONTAINER", "class_name": "MyContainer" }]
	},
	"exports": {
		"MyContainer": { "type": "durable-object", "storage": "sqlite" }
	}
}
```

Sandbox (`durable_object` policy). Omit `images` to use only the Cloudflare-managed `cloudflare/debian-trixie` image (Debian Trixie slim + Node.js 24):

```jsonc
{
	"compatibility_flags": ["nodejs_compat"],   // needed for @cloudflare/sandbox helpers
	"containers": [
		{
			"class_name": "MySandbox",
			"scheduling_policy": "durable_object",
			"images": { "workspace": { "dockerfile": "./Dockerfile" } }   // -> ctx.container.images.workspace
		}
	],
	"durable_objects": {
		"bindings": [{ "name": "MY_SANDBOX", "class_name": "MySandbox" }]
	},
	"exports": {
		"MySandbox": { "type": "durable-object", "storage": "sqlite" }
	}
}
```

`class_name` in `containers`, the binding, and the `exports` key must all match the exported class. Legacy apps may keep `migrations` (`new_sqlite_classes`) but never together with `exports`. Named images: up to 100, each `dockerfile` (+ `build_context`, `build_vars`) or a digest-pinned `image` `registry.cloudflare.com/<ACCOUNT_ID>/<REPO>@sha256:<DIGEST>`.

## Code

Service container:

```ts
import { Container, getContainer, getRandom } from "@cloudflare/containers";

export class MyContainer extends Container {
	defaultPort = 8080;     // fetch() waits until this port listens
	sleepAfter = "5m";      // idle timeout before the instance stops (default "10m")
	envVars = { MESSAGE: "hello" };
	// enableInternet = false;  // default true
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname.startsWith("/lb")) {
			return (await getRandom(env.MY_CONTAINER, 3)).fetch(request); // 3 interchangeable instances
		}
		return getContainer(env.MY_CONTAINER, "workspace-123").fetch(request); // one instance per ID
	},
};
```

Sandbox (direct `ctx.container`, plus optional `Files` helper from `@cloudflare/sandbox` 1.0):

```ts
import { DurableObject } from "cloudflare:workers";
import { Files } from "@cloudflare/sandbox"; // npm i @cloudflare/sandbox

const IDLE_MS = 10 * 60 * 1000;

export class MySandbox extends DurableObject<Env> {
	private async container() {
		const c = this.ctx.container;
		if (!c) throw new Error("The container binding is not configured");
		if (!c.running) {
			c.start({
				image: c.images.workspace,        // or "cloudflare/debian-trixie"
				instance: "standard-1",           // optional, default "lite"
				entrypoint: ["sleep", "infinity"],
				enableInternet: false,            // required whenever options are passed
			});
			await c.setInactivityTimeout(IDLE_MS);
		}
		return c;
	}

	async exec(argv: string[]) {               // no shell: use ["sh", "-c", "a && b"] for shell syntax
		const c = await this.container();
		const output = await (await c.exec(argv)).output();
		return { exitCode: output.exitCode, stdout: new TextDecoder().decode(output.stdout) };
	}

	async writeAndRead(path: string, text: string) {
		const files = new Files(await this.container());
		await files.writeFile(path, text);     // parent dir must exist; also: stat, readDirectory, mkdir, rename, remove
		return (await files.readFile(path)).text(); // readFile() resolves to a Response
	}

	async fetch(request: Request): Promise<Response> { // preview: proxy to a server in the sandbox
		return (await this.container()).getTcpPort(8080).fetch(request);
	}

	async save() {
		const snap = await this.ctx.container!.snapshotContainer({ name: "checkpoint" });
		await this.ctx.storage.put("snap", snap); // restore: start({ containerSnapshot: snap, enableInternet: false })
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const { argv } = (await request.json()) as { argv: string[] };
		return Response.json(await env.MY_SANDBOX.getByName("sandbox").exec(argv));
	},
};
```

`Files` needs the `sandbox-shim` binary in the image, version-matched to the npm package:

```dockerfile
FROM node:24-trixie-slim
COPY --from=docker.io/cloudflare/sandbox:1.0.0 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
RUN mkdir /workspace
CMD ["sleep", "infinity"]
```

Sandbox SDK: `@cloudflare/sandbox` 1.0 is a set of helpers (`Files`, `S3Mount`) used inside **your own** Durable Object next to `ctx.container`. The 0.x API (`getSandbox()`, `sandbox.exec("cmd")`, `proxyToSandbox`, `exposePort()`, exported `Sandbox` class) is legacy; do not use it for new projects. Choose plain `default`-policy Containers for a fixed service image; choose the sandbox path (`durable_object` policy + `ctx.container` + optional `@cloudflare/sandbox`) for per-task environments, runtime image/size choice, `exec()`, and snapshots. If the code only needs to call methods you define, use Dynamic Workers (`07b-dynamic-workers.md`).

## Verify

- Service: open `https://<worker>.<subdomain>.workers.dev/`; first request to a new ID is a cold start (often 1-3 s, depends on image). `npx wrangler containers list` shows the application.
- Sandbox: `curl http://localhost:8787 --request POST --json '{"argv":["uname","-a"]}'` returns `"exitCode":0` and `stdout` containing `Linux`.
- Logs: dashboard -> Workers & Pages -> Containers (status, metrics, logs).

## Gotchas

- Scaling is manual: one instance per Durable Object ID; `getRandom(binding, N)` for N stateless instances. No built-in autoscaling yet. `max_instances` caps the `default` policy only (not supported with `durable_object`; not applied in local dev).
- Sleep: `Container` class stops after `sleepAfter` idle (default 10 min). With `ctx.container`, without `setInactivityTimeout()` the instance stops shortly after the Durable Object goes idle; the timeout is lost when the Durable Object restarts, so set it again in the constructor if `container.running`.
- Disk is ephemeral: after sleep the next start uses a fresh disk from the image. Persist via Durable Object storage, R2 (FUSE), or snapshots (beta, `durable_object` policy only, tied to the image they were taken from, no memory/process state, kept 30 days from creation or last restore).
- `start()` returns before the process is ready: poll `getTcpPort(port).fetch()` before sending traffic. Servers must listen on `0.0.0.0`, not `127.0.0.1`.
- Inbound: Internet HTTP reaches an instance only through your Worker. Worker-to-container uses `getTcpPort(port).fetch()` (HTTP) or `.connect()` (raw TCP). No docs found today for direct end-user TCP or gRPC ingress.
- `durable_object` policy: the `Container` class is not supported; runtime sizes are `lite`, `standard-1..4` or `{ vcpu, memoryMib, diskMb }` (`basic`, `dev`, `standard` rejected); no direct pulls from Docker Hub/ECR/GAR (push to the Cloudflare registry first); no app-wide rollouts (running instances keep their start image).
- Deployed `durable_object` containers have a 64-char hostname that does not resolve (`python3 -m http.server` crashes); every process has root capabilities regardless of user.
- Platform may stop an instance at any time: `SIGTERM`, up to 15 min grace, then `SIGKILL`.
- `vite dev` cannot pull from the Cloudflare Registry; `wrangler dev` can. Set `DOCKER_HOST` if you see an opaque `internal error`.
- Observed with Wrangler 4.147.0 (not from the docs): `wrangler deploy --dry-run` builds the image when Docker is running, so a dry run needs Docker too. After `wrangler dev` exits, a `workerd-container-...-proxy` container and the images `cloudflare-dev/<class>` and `cloudflare/proxy-everything` stay on the machine; remove them with `docker rm` / `docker rmi` when disk matters.

## Limits and cost

| Instance type | vCPU | Memory | Disk |
| --- | --- | --- | --- |
| lite | 1/16 | 256 MiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |

Custom: 1-4 vCPU, max 12 GiB memory (min 3 GiB per vCPU), max 20 GB disk. Wrangler uses `vcpu`/`memory_mib`/`disk_mb`; runtime uses `vcpu`/`memoryMib`/`diskMb`. Account: 6 TiB memory, 1,500 vCPU, 30 TB disk concurrent; 50 GB image storage; snapshot max 20 GB.

Billing (Workers Paid, per 10 ms while running; memory and disk on provisioned size, CPU on active usage only):

| | Included / month | Then |
| --- | --- | --- |
| Memory | 25 GiB-hours | $0.0000025 / GiB-second |
| CPU | 375 vCPU-minutes | $0.000020 / vCPU-second |
| Disk | 200 GB-hours | $0.00000007 / GB-second |

Egress: North America + Europe 1 TB included then $0.025/GB; Oceania, Korea, Taiwan 500 GB then $0.05/GB; elsewhere 500 GB then $0.04/GB. Plus Workers requests/CPU and Durable Objects usage for the controlling object, and Workers Logs.

## Sources

- https://developers.cloudflare.com/containers/get-started/index.md
- https://developers.cloudflare.com/containers/configuration/wrangler/index.md
- https://developers.cloudflare.com/containers/configuration/scheduling-policy/index.md
- https://developers.cloudflare.com/containers/configuration/scaling-and-routing/index.md
- https://developers.cloudflare.com/containers/api/container-class/index.md
- https://developers.cloudflare.com/containers/api/durable-object-container/index.md
- https://developers.cloudflare.com/containers/guides/snapshots/index.md
- https://developers.cloudflare.com/containers/guides/local-dev/index.md
- https://developers.cloudflare.com/containers/guides/image-management/index.md
- https://developers.cloudflare.com/containers/faq/index.md
- https://developers.cloudflare.com/containers/platform/limits/index.md
- https://developers.cloudflare.com/containers/platform/pricing/index.md
- https://developers.cloudflare.com/sandbox/index.md
- https://developers.cloudflare.com/sandbox/get-started/index.md
- https://developers.cloudflare.com/sandbox/concepts/index.md
- https://developers.cloudflare.com/sandbox/files/manage-files/index.md
- https://developers.cloudflare.com/sandbox/reference/files/index.md
- https://developers.cloudflare.com/sandbox/previews/index.md
- https://developers.cloudflare.com/sandbox/sdk/migrate/changes-in-1-0/index.md
- https://blog.cloudflare.com/faster-agent-sandboxes/
- https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/
