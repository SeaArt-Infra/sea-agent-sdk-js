---
name: sea-agent-sdk-js
description: Integrate Node.js services with SeaArt Agent Gateway through the official sea-agent-sdk-js. Use for catalog lookup, Tool, MCP Server, Skill, Agent, Hook, chat completion, SSE or WebSocket streaming, chat replay, and cancellation in ESM applications.
---

# SeaAgent JavaScript SDK

Use `sea-agent-sdk-js` for Agent Gateway work in Node.js. Prefer its client and stream helpers over hand-written HTTP or SSE code.

## Workflow

1. Inspect `package.json` and use Node.js 18.17 or newer.
2. Add the ESM-only package with the project's package manager, for example `npm install sea-agent-sdk-js`.
3. Create one `SeaAgentClient` with the gateway endpoint, API key, and any global headers.
4. Use the lowercase client resource that matches the operation.
5. Run `npm test` after changing the integration.

The SDK appends `/agent-v2` when the configured endpoint does not already contain it. Store the API key outside source control. Send `X-User-ID` for Tool, MCP Server, Skill, and Agent writes when the gateway requires owner or operator metadata.

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

When `agentId` is set, the SDK sends the same value in `X-Agent-ID` and the JSON `agent_id` field; the gateway gives the header priority during the compatibility rollout.

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
| MCP Server registration and tool proxying | `mcps` |
| Skill registration and listing | `skills` |
| Agent registration and inspection | `agents` |
| Multimodal charge reservation hook | `hooks` |
| Chat, streaming, replay, cancellation | `chat` |

## Manage MCP Servers

Use `client.mcps` for `register`, `list`, `get`, `update`, `delete`, `tools`, and `call`. Registration and updates accept `streamable-http` or legacy `sse` transports; `call` accepts `{ name, arguments, timeout_ms }`. Include both `X-User-ID` and `X-Flag: 1` for MCP mutations. Gateway never returns stored upstream header values, only `header_keys`; access to a private server's `tools` and `call` operations requires its owner or `X-Admin-Access: 1`.

Pass list filters in each resource's options object. Keep custom gateway fields in `extraBody` only when the SDK has no first-class option. Put request-specific HTTP headers in `headers` on the chat options, not in the JSON body.

## Agent Skill Preload

Agent registration keeps `skills` as an array of Skill UUIDs. Add a UUID to
`pre_skills` only when that Skill is expected in most runs and the model needs
its full instruction before deciding what to do. Gateway injects it into the
resolved system prompt and avoids the initial Worker `read_file` call for its
`SKILL.md`, at the cost of system-prompt tokens on every run. Keep conditional,
occasional, long, or low-confidence Skills only in `skills` for progressive
Worker loading; do not preload a Skill merely because it is short.
`pre_skills` must be a duplicate-free subset of `skills`; every bound Skill
keeps its tool bindings.

## Medium-Term Memory Policy

For a registered Agent, use optional `config.memory_policy` in a concise
registration payload or `agent_config.memory_policy` in a low-level
create/update payload. Omit it for the normal persistent-session behavior;
use it to restrict a particular Agent:

```js
config: {
  memory_policy: {
    medium_term: { recall: false, learn: false },
  },
},
```

For a complete persistent session, `medium_term.recall` and
`medium_term.learn` both default to `true`. `recall` retrieves relevant
semantic memory as background context; `learn` queues a qualifying completed
run for asynchronous extraction rather than saving it synchronously. Both
default to `false` for ephemeral runs (no `metadata.session_id`) and are forced
off by a missing memory scope, user opt-out, or Worker
`MEMORY_MEDIUM_TERM_ENABLED=false`. Agent policy and request-level
`memory_policy` only restrict; pass a request-level override through
`extraBody`. Long-term recall and writes remain disabled by default.

## Verify And Protect Data

Run `npm test` from the package root. Verify a health check or a non-streaming chat before adding streaming UI behavior. Do not expose gateway API keys in browser code, commits, logs, errors, or telemetry. Redact complete prompts and raw Tool output from diagnostic logs.
