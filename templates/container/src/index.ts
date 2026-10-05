import { Container, getContainer } from "@cloudflare/containers";

export class AppContainer extends Container<Env> {
  defaultPort = 8080; // requests wait until the server in the container listens here
  sleepAfter = "5m"; // stop the instance after 5 idle minutes; container billing stops with it
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    // Answered by the Worker alone: does not start a container.
    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    // One instance per name. Use a user or session id here to give each its own container.
    return getContainer(env.APP_CONTAINER, "main").fetch(request);
  },
} satisfies ExportedHandler<Env>;
