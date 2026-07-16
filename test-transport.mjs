import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { SeaAgentClient } from "./src/client.js";
import { SeaAgentTransport } from "./src/transport.js";

test("non-streaming requests default to a 180 second timeout", () => {
  const client = new SeaAgentClient({ endpoint: "http://127.0.0.1:8080" });

  assert.equal(client.timeoutMs, 180_000);
  assert.equal(client.transport.timeoutMs, 180_000);
});

test("non-streaming request timeout can be overridden", async (t) => {
  const server = createServer((_request, response) => {
    setTimeout(() => response.end("late response"), 100);
  });
  await listen(server);
  t.after(() => closeServer(server));

  const address = server.address();
  const transport = new SeaAgentTransport(
    `http://127.0.0.1:${address.port}`,
    "",
    {},
    10,
  );

  await assert.rejects(
    transport.getText("/v1/test"),
    (error) => error?.name === "TimeoutError" || error?.code === "UND_ERR_ABORTED",
  );
});

test("non-streaming timeout does not apply to streams", async (t) => {
  const server = createServer((_request, response) => {
    setTimeout(() => response.end("data: done\n\n"), 50);
  });
  await listen(server);
  t.after(() => closeServer(server));

  const address = server.address();
  const transport = new SeaAgentTransport(
    `http://127.0.0.1:${address.port}`,
    "",
    {},
    10,
  );
  const chunks = [];

  await transport.getStream("/v1/test", undefined, (chunk) => chunks.push(chunk));

  assert.equal(chunks.join(""), "data: done\n\n");
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function closeServer(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
}
