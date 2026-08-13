import assert from "node:assert/strict";
import test from "node:test";
import { SkillsResource } from "./src/resources/skills.js";

test("Skill registration and update preserve MCP server bindings", async () => {
  const requests = [];
  const skills = new SkillsResource({
    async post(path, body) {
      requests.push({ method: "POST", path, body });
    },
    async put(path, body) {
      requests.push({ method: "PUT", path, body });
    },
  });
  const payload = {
    name: "mcp-research",
    config: {
      mcp_servers: ["11111111-1111-4111-8111-111111111111"],
    },
  };
  const expectedPayload = structuredClone(payload);

  await skills.register(payload);
  await skills.update("skill-1", payload);

  assert.deepEqual(requests, [
    { method: "POST", path: "/v1/skills/register", body: expectedPayload },
    { method: "PUT", path: "/v1/skills/skill-1", body: expectedPayload },
  ]);
  assert.deepEqual(payload, expectedPayload);
});
