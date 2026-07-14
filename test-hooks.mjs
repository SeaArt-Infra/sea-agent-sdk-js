import assert from "node:assert/strict";
import test from "node:test";
import { HooksResource } from "./src/resources/hooks.js";

const payload = {
  name: "production-line-hook",
  endpoint: "https://example.com/agent-hook",
  description: "Receives multimodal charge reservation events.",
};

test("hook methods use API-key-scoped routes without hook ids", async () => {
  const requests = [];
  const hooks = new HooksResource({
    async post(path, body) {
      requests.push({ method: "POST", path, body });
    },
    async put(path, body) {
      requests.push({ method: "PUT", path, body });
    },
    async delete(path) {
      requests.push({ method: "DELETE", path });
    },
  });

  await hooks.register(payload);
  await hooks.update(payload);
  await hooks.delete();

  assert.deepEqual(requests, [
    { method: "POST", path: "/v1/hooks/register", body: payload },
    { method: "PUT", path: "/v1/hooks", body: payload },
    { method: "DELETE", path: "/v1/hooks" },
  ]);
});
