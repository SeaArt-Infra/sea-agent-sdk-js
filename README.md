# sea-agent-sdk-js

> Beta: SDK APIs and `agent-gateway` behavior may still change with gateway versions.

Node.js SDK for `agent-gateway`. It wraps the gateway APIs for catalog lookup, resource registration, chat completion, SSE streaming, WebSocket streaming, chat replay, and hook management.

The package is ESM-only and requires Node.js 18.17 or newer.

## Available Resources

| Resource | Client field | What it does |
| --- | --- | --- |
| System | `client.system` | Health and metrics checks |
| Catalog | `client.catalog` | List resolved catalog entries |
| Tools | `client.tools` | Register, list, update, delete, and resolve tools |
| Skills | `client.skills` | Register, list, update, and delete skills |
| Agents | `client.agents` | Register, list, update, delete, and inspect agents |
| Hooks | `client.hooks` | Register and manage worker event hook endpoints |
| Chat | `client.chat` | Run chat, stream chat, replay events, and cancel chats |

## How It Works

1. Create a `SeaAgentClient` with an agent-gateway endpoint and optional API key.
2. The SDK normalizes the endpoint to include `/agent-v2` when needed.
3. Each resource helper sends gateway-compatible HTTP requests with global and per-request headers.
4. Chat helpers can either return a full response or process SSE/WebSocket events through callbacks.
5. Streaming helpers automatically resume transient disconnects from the last delivered event sequence.

`X-User-ID` is required for `tools`, `skills`, and `agents` write operations when the gateway needs provider, owner, or operator metadata.

## Quick Start

Install the package from the internal npm registry configured for SeaArt packages:

```bash
npm install sea-agent-sdk-js
```

The package is currently documented as an internal package. Make sure your project-level `.npmrc` or user npm configuration points to the internal registry before running the install command.

For local development inside this repository:

```bash
npm install
```

Create a client and run a chat request:

```js
import { SeaAgentClient } from "sea-agent-sdk-js";

const client = new SeaAgentClient({
  endpoint: "http://127.0.0.1:8080",
  apiKey: process.env.AGENT_GATEWAY_API_KEY,
  headers: {
    "X-User-ID": "production-line-123",
  },
});

const result = await client.chat.run({
  agentId: "33333333-3333-4333-8333-333333333333",
  message: "Search recent AI news and summarize the top 3 items.",
});

console.log(result);
```

Check gateway health:

```js
const health = await client.system.health();
console.log(health);
```

## Configuration

Pass options directly:

```js
const client = new SeaAgentClient({
  endpoint: "http://127.0.0.1:8080",
  apiKey: process.env.AGENT_GATEWAY_API_KEY,
  headers: {
    "X-User-ID": "production-line-123",
  },
});
```

`endpoint` may be the gateway base URL or a URL that already includes `/agent-v2`. The SDK appends `/agent-v2` before sending requests when it is missing.

## Listing Resources

List APIs pass gateway filters through SDK option objects. Common filters are `search`, `status`, `provider`, `public`, `limit`, and `offset`. Compatibility filters include `sourceKind`, `ownerId`, and `category`.

```js
const tools = await client.tools.list({
  provider: "web-tools-mcp",
  status: "active",
  limit: 20,
});

console.log(tools);
```

Pagination follows the gateway behavior: `limit` defaults to 20 when omitted or `<= 0`, the gateway caps values above 200, and `offset` starts at 0.

## Chat Requests

Use `message` for the common single-user-message case:

```js
const result = await client.chat.run({
  agentId: "33333333-3333-4333-8333-333333333333",
  message: "Fetch https://example.com and explain what it is.",
});
```

Use `skillIds` to temporarily mount extra Skills for a registered Agent run when it needs one-off capabilities without changing its saved configuration. Agent Gateway accepts at most 20 active, visible Skill UUIDs, merges them after the Agent's own Skills, dedupes repeated IDs, rejects `skillIds` when `agentConfig` is used, and only lets Skill runtime config fill Agent defaults that are unset.

```js
const result = await client.chat.run({
  agentId: "33333333-3333-4333-8333-333333333333",
  skillIds: ["11111111-1111-1111-1111-111111111111"],
  message: "Use the extra skill for this run.",
});
```

Use `messages` for multi-turn conversations:

```js
const result = await client.chat.run({
  agentId: "33333333-3333-4333-8333-333333333333",
  messages: [
    { role: "system", content: "Answer in concise Chinese." },
    { role: "user", content: "Fetch https://example.com and explain what it is." },
  ],
});
```

Use OpenAI-style content parts for multimodal messages:

```js
const result = await client.chat.run({
  agentId: "33333333-3333-4333-8333-333333333333",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Describe this image." },
        {
          type: "image_url",
          image_url: {
            url: "https://example.com/image.png",
          },
        },
      ],
    },
  ],
});
```

Attach request metadata and per-request headers when gateway or worker tracing needs them:

```js
const result = await client.chat.run({
  requestId: "req_123",
  agentId: "33333333-3333-4333-8333-333333333333",
  category: "fabric",
  message: "Summarize this request context.",
  metadata: {
    session_id: "sess_123",
    user_id: "user_456",
    trace_id: "trace_789",
  },
  headers: {
    "X-Trace-ID": "trace_789",
  },
});
```

`request_id`, `category`, and `metadata` are sent in the chat body. Custom headers are forwarded when the SDK creates non-streaming, SSE, or WebSocket chat requests. Use `extraBody` for gateway fields that are not yet exposed as first-class SDK options.

## Streaming

SSE is the default stream transport and works well with most HTTP gateways and proxies:

```js
import { SeaAgentClient } from "sea-agent-sdk-js";

const client = new SeaAgentClient({
  endpoint: "http://127.0.0.1:8080",
  apiKey: process.env.AGENT_GATEWAY_API_KEY,
});

const text = await client.chat.runStream(
  {
    agentId: "33333333-3333-4333-8333-333333333333",
    message: "Fetch https://example.com and summarize it in one paragraph.",
  },
  {
    transport: "sse",
    onTextDelta(delta, event) {
      process.stdout.write(delta);
    },
    onEvent(event) {
      // event.id is the SSE/WebSocket ID; event.seq is its numeric resume cursor.
      // Persist them if the application needs to resume after a process restart.
    },
    onReconnect({ attempt, runId, afterSeq, error }) {
      console.warn("stream reconnect", { attempt, runId, afterSeq, error });
    },
  },
);

console.log("\n\nFinal text:", text);
```

Switch to WebSocket when the caller wants a persistent connection or already manages WebSocket lifecycle:

```js
const text = await client.chat.runStream(
  {
    agentId: "33333333-3333-4333-8333-333333333333",
    message: "Tell me what tools you can use, then answer with a short plan.",
  },
  {
    transport: "ws",
    onTextDelta(delta, event) {
      process.stdout.write(delta);
    },
    onEvent(event) {
      if (event.event === "error") {
        console.error("stream error event:", event.data);
      }
    },
  },
);

console.log("\n\nFinal text:", text);
```

### Worker Stream Event Format

`agent-gateway` forwards worker stream events as SSE blocks or WebSocket messages. The SDK normalizes both transports into `{ id, seq, event, data }`. `id` is the raw SSE/WebSocket event ID, while `seq` is its positive safe-integer value (`0` for heartbeat, a missing ID, or an ID outside JavaScript's safe-integer range). Both `onEvent` and the event passed to `onTextDelta` receive these fields. Use `onTextDelta` for assistant text and `onEvent` for all raw lifecycle, tool, skill, and terminal events.

SSE frames use the standard event/data envelope:

```text
event: response.text.delta
data: {"type":"response.text.delta","response_id":"run_xxx","item_id":"item_run_xxx_msg","output_index":0,"content_index":0,"delta":"hello"}
id: 12
```

WebSocket frames carry the same payload under `data`:

```json
{
  "id": "12",
  "event": "response.text.delta",
  "data": {
    "type": "response.text.delta",
    "response_id": "run_xxx",
    "item_id": "item_run_xxx_msg",
    "output_index": 0,
    "content_index": 0,
    "delta": "hello"
  }
}
```

Common worker event sequence:

| Event | When it appears | Important fields in `data` |
| --- | --- | --- |
| `response.created` | Run accepted and response object created | `type`, `response.id`, `response.status`, `response.model`, `response.metadata` |
| `response.in_progress` | Run enters processing | `type`, `response.id`, `response.status` |
| `response.output_item.added` | Assistant message item or tool call item starts | `response_id`, `output_index`, `item.type`, `item.id`, `item.status`; tool calls also include `item.call_id`, `item.name` |
| `response.content_part.added` | Assistant text content part starts | `response_id`, `item_id`, `output_index`, `content_index`, `part.type` |
| `chat.delta` | Legacy assistant text chunk | `content`, `text`, or `delta` |
| `response.text.delta` | Assistant text token/chunk | `response_id`, `item_id`, `output_index`, `content_index`, `delta` |
| `response.function_call_arguments.done` | Tool call arguments are finalized | `response_id`, `item_id`, `call_id`, `name`, `arguments` as a JSON string |
| `fabric.tool.started` | Worker starts a tool call | `tool.id`, `tool.call_id`, `tool.name`, `tool.status`, `tool.arguments` |
| `fabric.tool.completed` | Worker finishes a tool call | `tool.status`, `tool.output`, `tool.output_text`, `tool.output_type`; structured tool protocols may add `tool.structured_content`, `tool.protocol_type`, `tool.tool_response` |
| `fabric.skill.started` | Worker loads a skill through a `read_file` tool call | `skill.id`, `skill.name`, `skill.status`, `skill.path` |
| `fabric.skill.completed` | Skill file load completes | `skill.status`, `skill.output`, `skill.output_text`, `skill.path` |
| `response.text.done` | Assistant final text is known | `response_id`, `item_id`, `content_index`, `text` |
| `response.content_part.done` | Assistant text content part completes | `part.type`, `part.text` |
| `response.output_item.done` | Assistant message or function call output item completes | `item.type`, `item.status`, `item.content` for messages; `item.call_id`, `item.arguments`, `item.output` for tool calls |
| `response.completed` | Run completed successfully | `response.id`, `response.status`, `response.usage`, `response.elapsed_ms`, `response.metadata`, `response.output` |
| `response.failed` | Run failed | `response.status`, `response.error.type`, `response.error.code`, `response.error.message` |
| `response.cancelled` / `response.canceled` | Run was cancelled | `response.status`, `response.cancel_reason` |
| `chat.response` / `chat.completed` | Legacy successful terminal event | `content`, `finish_reason` |
| `chat.failed` / `chat.cancelled` | Legacy failed or cancelled terminal event | `error_code`, `error_message`, `status` |

The SDK accumulates returned text from `response.text.delta`. It also keeps compatibility with `response.output_text.delta`, `chat.delta`, `chat.response`, and `message.delta` text events. Tool, skill, usage, metadata, and terminal details are not passed to `onTextDelta`; inspect them in `onEvent`.

Terminal events are `response.completed`, `response.failed`, `response.cancelled`, `response.canceled`, `chat.response`, `chat.completed`, `chat.failed`, and `chat.cancelled`. After the terminal event callbacks complete successfully, the SDK commits its sequence, ignores any later frames, and closes the active SSE or WebSocket connection without waiting for the server to close it.

### Automatic Resume

`runStream()`, `streamCompletion()`, and `stream()` automatically resume when a connection ends before a terminal event. The SDK remembers the last event delivered successfully and reconnects with `after_seq`. If the connection fails before `chat.created` supplies a run ID, the SDK retries the creation request with one stable, automatically generated `request_id`, so the gateway can replay the same run instead of starting another one. Incomplete SSE frames and replayed sequence numbers are discarded. A successfully processed terminal event stops the connection immediately and is never retried, even if closing the underlying socket also reports an error.

Configure resume behavior in the handlers object:

```js
const controller = new AbortController();

await client.chat.runStream(options, {
  signal: controller.signal,
  autoResume: true,          // default
  maxReconnects: 3,         // retries after the initial connection
  reconnectDelayMs: 250,    // exponential backoff base
  maxReconnectDelayMs: 5000,
  onReconnect(details) {
    console.warn(details.attempt, details.runId, details.afterSeq);
  },
  onTextDelta(delta) {
    process.stdout.write(delta);
  },
});
```

| Handler field | Default | Behavior |
| --- | --- | --- |
| `autoResume` | `true` | Resume a stream that closes before a terminal event |
| `maxReconnects` | `3` | Reconnect attempts after the initial connection; `0` disables retries |
| `reconnectDelayMs` | `250` | Initial reconnect delay in milliseconds |
| `maxReconnectDelayMs` | `5000` | Maximum exponential-backoff delay in milliseconds |
| `signal` | `undefined` | Abort the active connection or a pending reconnect delay |
| `onReconnect` | `undefined` | Receives `{ attempt, delayMs, runId, afterSeq, error }` |

EOF, network failures, HTTP `408`/`429`, and `5xx` responses are retried. Abort, other `4xx` responses, explicit WebSocket `error` events, and exceptions from user callbacks are returned immediately. Non-JSON event data remains available as raw text. Set `autoResume: false` for one-shot connection behavior. Automatic resume covers connection loss in the current process; persist `runId` and `seq` and call `stream(runId, ..., { afterSeq: seq })` when recovery must survive a process restart.

## Replay an Existing Chat

If another SDK client or application created the chat, subscribe by chat ID. `afterSeq` selects the initial cursor; later connection loss is resumed automatically from the last delivered event.

```js
const chatId = "chat_xxxxxxxxxxxxx";

const text = await client.chat.stream(
  chatId,
  {
    transport: "sse",
    onTextDelta(delta, event) {
      process.stdout.write(delta);
    },
  },
  {
    afterSeq: 0,
  },
);

console.log("\n\nReceived text:", text);
```

Use `transport: "ws"` with the same API to replay over WebSocket.

## Inline Agent Config

Pass `agentConfig` when the request should not reference a registered agent. Runtime fields such as `temperature`, `max_turns`, and `timeout` are forwarded by `agent-gateway` to the worker.

```js
const result = await client.chat.run({
  category: "fabric",
  agentConfig: {
    agent: {
      name: "inline-assistant",
      model: "gpt-4.1-mini",
      reasoning_effort: "medium",
      temperature: 0.2,
      max_turns: 6,
      timeout: 120,
      system_prompt: "Answer in Chinese and keep the answer brief.",
    },
  },
  message: "Explain what agent-gateway does.",
});
```

Declare a sandbox template when the gateway should start a sandbox for the inline agent. Supported template values are `react-game` and `react-web`.

```js
const result = await client.chat.run({
  category: "fabric",
  agentConfig: {
    agent: {
      name: "inline-sandbox-agent",
      model: "gpt-4.1-mini",
      system_prompt: "Build and modify React apps inside the sandbox.",
    },
    runtime: {
      sandbox: {
        sandbox_template: "react-game",
      },
    },
  },
  message: "Create a small React game.",
});
```

## Register Tools, Skills, and Agents

`agent-gateway` uses server-generated UUID `id` values as resource identities. Registry lookup and association should use UUIDs; do not send removed `tool_key`, `skill_key`, or `agent_key` fields.

Register an HTTP tool:

```js
const tool = await client.tools.register({
  name: "search_web",
  description: "Search public web pages.",
  runtime_type: "http",
  endpoint: "https://example.com/tools/search",
  service_name: "example",
  method: "POST",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
  },
  enabled: true,
  public: false,
});
```

`service_name` is a top-level tool field beside `name`. It identifies the backing service shared by tools on the same server. If omitted, the gateway derives it from the endpoint host prefix; builtin and no-endpoint tools default to `deepagent`. Do not put `service_name` in metadata/config, and do not send `inject_user_credentials` in user-facing registration payloads.

Register a skill:

```js
const skill = await client.skills.register({
  name: "web-research",
  description: "Research a topic with web tools.",
  instruction: "Search, compare sources, and summarize findings.",
  required_tools: [
    "22222222-2222-4222-8222-222222222222",
  ],
  enabled: true,
  public: false,
});
```

When `required_tools` or `optional_tools` contains registered HTTP Tool UUID strings, the gateway normalizes them to `{ type: "http", ref: "<tool-uuid>" }`. Use object entries when you need non-default tool types:

```js
required_tools: [
  { type: "http", ref: "22222222-2222-4222-8222-222222222222" },
  { type: "builtin", ref: "seaart:generate_image" },
  { type: "mcp", ref: "filesystem:read_file", server: "mcp-filesystem" },
],
```

`type` is required and must be `http`, `http_batch`, `builtin`, or `mcp`. MCP entries also require `server`. Do not use Tool `name` or old `tool_key` values as `ref`.

Register an agent:

```js
const agent = await client.agents.register({
  name: "web_assistant",
  category: "fabric",
  system_prompt: "You are a web research assistant.",
  skills: ["11111111-1111-4111-8111-111111111111"],
  config: {
    temperature: 0.2,
    max_turns: 6,
  },
  enabled: true,
});
```

## Skill Runtime Rules

| Field | Rule |
| --- | --- |
| `name` | Must match `^[a-z0-9-]+$`; use lowercase letters, numbers, and hyphens only |
| `description` | Required; keep it short because the gateway writes it to inline `SKILL.md` frontmatter |
| `instruction` | Required; full Markdown body for the skill |
| `required_tools` / `optional_tools` | Use UUID refs for registered HTTP, HTTP Batch, and registered builtin tools |

When an agent runs with a registered skill, the gateway assembles an inline skill document:

```md
---
name: web-research
description: Research a topic with web tools.
---

Search, compare sources, and summarize findings.
```

## Hook Endpoints

Register a hook endpoint for worker events:

```js
const hook = await client.hooks.register({
  name: "production-line-hook",
  endpoint: "https://example.com/agent-hook",
  description: "Receives Agent Worker events for the configured API key.",
  metadata: {},
});
```

Hooks use `apiKey` as `Authorization: Bearer ...`; do not send `api_key` in the payload. Worker calls use `POST`, and the receiver should filter by `event_id` in the event payload when needed.

## API Reference

| Area | Methods |
| --- | --- |
| System | `health()`, `metrics()` |
| Catalog | `list(options)` |
| Tools | `register(payload)`, `list(options)`, `get(toolId)`, `update(toolId, payload)`, `delete(toolId)`, `resolve(toolId)` |
| Skills | `register(payload)`, `list(options)`, `get(skillId)`, `update(skillId, payload)`, `delete(skillId)` |
| Agents | `register(payload)`, `list(options)`, `get(agentId)`, `update(agentId, payload)`, `delete(agentId)`, `capabilities(agentId)` |
| Hooks | `register(payload)`, `list(options)`, `get(hookId)`, `update(hookId, payload)`, `delete(hookId)` |
| Chat | `createCompletion(payload)`, `streamCompletion(payload, handlers)`, `run(options)`, `runStream(options, handlers)`, `get(chatId)`, `events(chatId, options)`, `stream(chatId, handlers, options)`, `cancel(chatId)` |

## Stream Utilities

If you need to process raw stream data yourself, the package also exports these helpers:

```js
import {
  createChatStreamProcessor,
  parseSSE,
  parseWebSocketEvent,
  textFromStreamEvent,
} from "sea-agent-sdk-js";
```

## Next Steps

- Start with `client.chat.run()` for non-streaming requests.
- Use `client.chat.runStream()` with SSE for most streaming integrations.
- Use `client.chat.stream()` with `afterSeq` to resume an existing chat after a process restart.
- Register tools, skills, and agents with UUID-based references only.
