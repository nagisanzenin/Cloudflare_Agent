import { DurableObject } from "cloudflare:workers";

// One instance per name, each with its own private SQLite database.
export class Counter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS hits (ts INTEGER NOT NULL)");
  }

  async increment(): Promise<number> {
    this.ctx.storage.sql.exec("INSERT INTO hits (ts) VALUES (?)", Date.now());
    return this.count();
  }

  async count(): Promise<number> {
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM hits").one().n;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/counter\/([\w-]{1,64})$/);
    if (!match) {
      return Response.json({ error: "use GET or POST /counter/<name>" }, { status: 404 });
    }

    const name = match[1];
    const stub = env.COUNTER.getByName(name);
    // Methods on the class are called over RPC; no fetch handler inside the object is needed.
    const count = request.method === "POST" ? await stub.increment() : await stub.count();
    return Response.json({ name, count });
  },
} satisfies ExportedHandler<Env>;
