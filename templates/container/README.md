# container

A Worker in front of a Linux container. The Worker receives every request and forwards it to a container instance that it starts on demand and that sleeps when idle.

Use this only when a Worker cannot run the workload: native binaries, another language runtime, more than 128 MB of memory.

## Run locally (needs Docker running)

```bash
npm install
docker info            # must succeed
npx wrangler dev       # builds the image on first run
```

```bash
curl localhost:8787/health   # {"ok":true} from the Worker, no container started
curl localhost:8787/         # JSON from the container; the first call waits for it to start
```

`npm run check` also needs Docker: the dry run builds the image. After `wrangler dev` exits, a `workerd-container-...-proxy` container and the images `cloudflare-dev/appcontainer` and `cloudflare/proxy-everything` stay on the machine. Remove them with `docker rm` and `docker rmi` when you are done.

## Before the first deploy

Containers require the Workers Paid plan and are billed while an instance runs. Follow `AGENTS.md` in the handbook repo and get a spending cap from the owner first.

1. Docker must be running: `wrangler deploy` builds the image and pushes it to the Cloudflare registry.
2. Check and deploy: `npm run check && npx wrangler deploy`
3. Wait a few minutes after the first deploy before the container answers.

Handbook cards: `07-containers-sandbox.md`, `10-cost-and-limits.md`.
