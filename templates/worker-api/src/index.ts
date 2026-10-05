type Note = { id: number; body: string; created_at: string };

const NOTES_CACHE_KEY = "notes:latest";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/notes" && request.method === "GET") {
      const cached = await env.CACHE.get<Note[]>(NOTES_CACHE_KEY, "json");
      if (cached) return Response.json(cached, { headers: { "x-cache": "hit" } });

      const { results } = await env.DB
        .prepare("SELECT id, body, created_at FROM notes ORDER BY id DESC LIMIT 20")
        .all<Note>();
      // KV is eventually consistent: keep the TTL short and treat it as a cache only.
      ctx.waitUntil(env.CACHE.put(NOTES_CACHE_KEY, JSON.stringify(results), { expirationTtl: 60 }));
      return Response.json(results, { headers: { "x-cache": "miss" } });
    }

    if (url.pathname === "/api/notes" && request.method === "POST") {
      const payload = await request.json<{ body?: unknown }>().catch(() => null);
      if (!payload || typeof payload.body !== "string" || payload.body.length === 0) {
        return Response.json({ error: "body must be a non-empty string" }, { status: 400 });
      }
      const note = await env.DB
        .prepare("INSERT INTO notes (body) VALUES (?) RETURNING id, body, created_at")
        .bind(payload.body)
        .first<Note>();
      ctx.waitUntil(env.CACHE.delete(NOTES_CACHE_KEY));
      return Response.json(note, { status: 201 });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
