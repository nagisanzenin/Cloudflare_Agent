export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/hello") {
      return Response.json({ message: "hello from the Worker", colo: request.cf?.colo ?? "local" });
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not found" }, { status: 404 });
    }

    // Anything else falls through to the static assets (and the SPA fallback).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
