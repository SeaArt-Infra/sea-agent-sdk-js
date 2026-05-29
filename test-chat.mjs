import assert from "node:assert/strict";
import test from "node:test";
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
