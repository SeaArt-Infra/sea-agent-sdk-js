---
name: sea-agent-sdk-js
description: Integrate Node.js services with SeaArt Agent Gateway through the official sea-agent-sdk-js. Use for catalog lookup, Tool, Skill, Agent, Hook, chat completion, SSE or WebSocket streaming, chat replay, and cancellation in ESM applications.
---

# SeaAgent JavaScript SDK

Use `sea-agent-sdk-js` for Agent Gateway work in Node.js. Prefer its client and stream helpers over hand-written HTTP or SSE code.

## Workflow

1. Inspect `package.json` and use Node.js 18.17 or newer.
2. Add the ESM-only package with the project's package manager, for example `npm install sea-agent-sdk-js`.
3. Create one `SeaAgentClient` with the gateway endpoint, API key, and any global headers.
4. Use the lowercase client resource that matches the operation.
5. Run `npm test` after changing the integration.

The SDK appends `/agent-v2` when the configured endpoint does not already contain it. Store the API key outside source control. Send `X-User-ID` for Tool, Skill, and Agent writes when the gateway requires owner or operator metadata.

## Create A Client

```js
import { SeaAgentClient } from "sea-agent-sdk-js";

const client = new SeaAgentClient({
  endpoint: process.env.AGENT_GATEWAY_ENDPOINT,
  apiKey: process.env.AGENT_GATEWAY_API_KEY,
  headers: { "X-User-ID": userId },
});
```

Use `await SeaAgentClient.fromConfig()` only when the service intentionally shares `~/.seaagent/config.yaml`.

## Run And Stream Chat

Use `message` for a single user turn and `messages` for a multi-turn or multimodal request. Do not set both `agentConfig` and `skillIds`; `skillIds` add temporary Skills to an Agent run.

```js
const result = await client.chat.run({
  agentId,
  message: "Summarize this request.",
});
```

Use SSE by default. Use WebSocket only when the caller needs a persistent connection or manages a WebSocket lifecycle.

```js
const text = await client.chat.runStream(
  { agentId, message: "Explain the result as it arrives." },
  {
    transport: "sse",
    onTextDelta(delta) {
      process.stdout.write(delta);
    },
  },
);
console.log("\nFinal text:", text);
```

Preserve the default reconnect behavior unless product requirements demand a different retry policy. Use `client.chat.events`, `client.chat.stream`, or `client.chat.cancel` to replay, resume, or cancel an existing chat.

## Select Resources

| Task | Client resource |
| --- | --- |
| Health or metrics | `system` |
| Resolved catalog entries | `catalog` |
| Tool registration and resolution | `tools` |
| Skill registration and listing | `skills` |
| Agent registration and inspection | `agents` |
| Multimodal charge reservation hook | `hooks` |
| Chat, streaming, replay, cancellation | `chat` |

Pass list filters in each resource's options object. Keep custom gateway fields in `extraBody` only when the SDK has no first-class option. Put request-specific HTTP headers in `headers` on the chat options, not in the JSON body.

## Verify And Protect Data

Run `npm test` from the package root. Verify a health check or a non-streaming chat before adding streaming UI behavior. Do not expose gateway API keys in browser code, commits, logs, errors, or telemetry. Redact complete prompts and raw Tool output from diagnostic logs.
