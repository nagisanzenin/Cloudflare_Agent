import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

type Job = { kind: "welcome-email"; to: string };
type SignupParams = { email: string };

// Durable multi-step job: each step's result is persisted, failed steps retry on their own.
export class SignupWorkflow extends WorkflowEntrypoint<Env, SignupParams> {
  async run(event: WorkflowEvent<SignupParams>, step: WorkflowStep) {
    const user = await step.do("create user", async () => {
      return { id: crypto.randomUUID(), email: event.payload.email };
    });

    await step.sleep("wait before the welcome email", "10 seconds");

    await step.do(
      "queue welcome email",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        await this.env.JOBS.send({ kind: "welcome-email", to: user.email } satisfies Job);
      },
    );

    return user;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/signup") {
      const payload = await request.json<{ email?: unknown }>().catch(() => null);
      if (!payload || typeof payload.email !== "string") {
        return Response.json({ error: "email must be a string" }, { status: 400 });
      }
      const instance = await env.SIGNUP.create({ params: { email: payload.email } });
      return Response.json({ instanceId: instance.id }, { status: 202 });
    }

    const match = url.pathname.match(/^\/signup\/([\w-]+)$/);
    if (request.method === "GET" && match) {
      const instance = await env.SIGNUP.get(match[1]);
      return Response.json(await instance.status());
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },

  // Queue consumer: ack what succeeded, retry what failed. Unhandled messages go to the dead-letter queue after max_retries.
  async queue(batch): Promise<void> {
    for (const message of batch.messages) {
      try {
        console.log("job", message.id, JSON.stringify(message.body));
        message.ack();
      } catch (err) {
        console.error("job failed", message.id, err);
        message.retry({ delaySeconds: 30 });
      }
    }
  },

  // Cron Trigger. Locally: `wrangler dev`, then GET /cdn-cgi/local/scheduled?cron=0+3+*+*+*
  async scheduled(controller): Promise<void> {
    console.log("cron", controller.cron, new Date(controller.scheduledTime).toISOString());
  },
} satisfies ExportedHandler<Env, Job>;
