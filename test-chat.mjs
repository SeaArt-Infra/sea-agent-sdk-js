import assert from "node:assert/strict";
import test from "node:test";
import { REASONING_EFFORTS } from "./src/index.js";
import { ChatResource } from "./src/resources/chat.js";

test("run forwards multimodal chat messages unchanged", async () => {
  let seen;
  const chat = new ChatResource({
    async post(path, body) {
      seen = { path, body };
      return { ok: true };
    },
  });

  await chat.run({
    agentId: "agent_1",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "描述这张图片" },
          {
            type: "image_url",
            image_url: {
              url: "https://image.cdn2.seaart.me/a.png",
            },
          },
        ],
      },
    ],
  });

  assert.equal(seen.path, "/v1/chat/completions");
  assert.deepEqual(seen.body.messages[0].content, [
    { type: "text", text: "描述这张图片" },
    {
      type: "image_url",
      image_url: {
        url: "https://image.cdn2.seaart.me/a.png",
      },
    },
  ]);
});

test("run forwards skill ids", async () => {
  let seen;
  const chat = new ChatResource({
    async post(path, body) {
      seen = { path, body };
      return { ok: true };
    },
  });

  await chat.run({
    agentId: "agent_1",
    skillIds: ["11111111-1111-1111-1111-111111111111"],
    message: "hello",
  });

  assert.equal(seen.path, "/v1/chat/completions");
  assert.deepEqual(seen.body.skill_ids, ["11111111-1111-1111-1111-111111111111"]);
});

test("run forwards reasoning effort only when specified", async () => {
  let seen;
  const chat = new ChatResource({
    async post(path, body) {
      seen = { path, body };
      return { ok: true };
    },
  });

  await chat.run({
    agentId: "agent_1",
    reasoningEffort: REASONING_EFFORTS.OFF,
    message: "hello",
  });
  assert.equal(seen.body.reasoning_effort, "off");

  await chat.run({ agentId: "agent_1", message: "hello" });
  assert.equal(Object.hasOwn(seen.body, "reasoning_effort"), false);

  await chat.run({
    agentId: "agent_1",
    reasoningEffort: REASONING_EFFORTS.HIGH,
    extraBody: { reasoning_effort: REASONING_EFFORTS.LOW },
    message: "hello",
  });
  assert.equal(seen.body.reasoning_effort, "high");
});

test("chat requests send agent id in both the header and body", async () => {
  let seen;
  const chat = new ChatResource({
    async post(path, body, headers) {
      seen = { path, body, headers };
      return { ok: true };
    },
  });

  const requestHeaders = { "x-agent-id": "stale-agent", "X-Trace-ID": "trace-1" };
  await chat.run({ agentId: "agent_1", message: "hello", headers: requestHeaders });

  assert.equal(seen.path, "/v1/chat/completions");
  assert.equal(seen.body.agent_id, "agent_1");
  assert.equal(seen.headers["X-Agent-ID"], "agent_1");
  assert.equal(seen.headers["x-agent-id"], undefined);
  assert.equal(seen.headers["X-Trace-ID"], "trace-1");
  assert.equal(requestHeaders["x-agent-id"], "stale-agent");
});
