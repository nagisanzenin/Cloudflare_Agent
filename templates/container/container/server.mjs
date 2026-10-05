// Runs inside the container. Any language or binary works here; this one is plain Node.js.
import { createServer } from "node:http";
import { hostname } from "node:os";

const startedAt = Date.now();

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      message: "hello from the container",
      path: req.url,
      host: hostname(),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    }),
  );
});

// Listen on 0.0.0.0: the Worker cannot reach a server bound to 127.0.0.1.
server.listen(8080, "0.0.0.0", () => console.log("container listening on 8080"));
