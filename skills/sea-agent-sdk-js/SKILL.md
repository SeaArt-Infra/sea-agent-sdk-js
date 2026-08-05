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

## Per-Chat Reasoning

Use the top-level `reasoningEffort` option only to override the selected Agent
for this run. Omit it when the caller did not choose a level so the Agent and
Fabric defaults remain effective. The supported platform values are `off`,
`on`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`; prefer
the exported `REASONING_EFFORTS` values and only select values verified for the
Agent's model route. Do not send provider-specific thinking fields through
`extraBody`.

## Agent Default Reasoning

To save a default level on an Agent, set `model.reasoning_effort` in the
concise registration payload. A chat without `reasoningEffort` uses that
default; an explicit chat value applies only to that chat. Full create and
update payloads use `model_config.reasoning_effort` instead.

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

## Bind MCP Servers To Skills

Select an `active`, current-user-visible MCP Server UUID from `client.mcps`
registration or listing; never accept a `server_url` in a Skill payload.

```js
await client.skills.register({
  name: "mcp-research",
  instruction: "Use the registered MCP tools when relevant.",
  config: { mcp_servers: ["<registered-mcp-server-uuid>"] },
  enabled: true,
});
```

`config.mcp_servers` is separate from `required_tools`: do not represent an
MCP Server UUID as a Tool reference. Gateway resolves the UUID and enforces
its active status and visibility. Skill runtime binding currently supports
an unauthenticated Streamable HTTP endpoint. The MCP Server `public` field
controls cross-production-line sharing, so keep it false unless sharing is
intended.

Pass list filters in each resource's options object. Keep custom gateway fields in `extraBody` only when the SDK has no first-class option. Put request-specific HTTP headers in `headers` on the chat options, not in the JSON body.

## Agent Skill Preload

Agent registration keeps `skills` as an array of Skill UUIDs. Repeat the UUID
of a short instruction needed on every run in `pre_skills`: gateway injects it
into the resolved system prompt and avoids the initial Worker `read_file` call
for its `SKILL.md`. Skills only in `skills` retain progressive Worker loading.
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
