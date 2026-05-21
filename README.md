# sea-agent-sdk-js

基于当前 `sea-agent-cli` 项目整理出的 Node.js SDK，用于调用 `agent-gateway` 的注册、查询、聊天、SSE 流式响应和 WebSocket 流式响应接口。

## 安装

```bash
npm install sea-agent-sdk-js
```

如果你当前是本地开发：

```bash
npm install
```

当前包使用 ESM，并要求 Node.js 18 或更高版本。

## 初始化

```js
import { SeaAgentClient } from "sea-agent-sdk-js";

const client = new SeaAgentClient({
  endpoint: "http://127.0.0.1:8080",
  apiKey: process.env.AGENT_GATEWAY_API_KEY,
  headers: {
    "X-User-ID": "production-line-123",
  },
});

const health = await client.system.health();
console.log(health);
```

也可以复用 CLI 的默认配置文件：

```js
import { SeaAgentClient } from "sea-agent-sdk-js";

const client = await SeaAgentClient.fromConfig();
```

默认读取 `~/.seaagent/config.yaml`，格式与 CLI 一致：

```yaml
endpoint: http://127.0.0.1:8080
apiKey: sa-xxxxxxxx
```

`endpoint` 可以是网关 base URL，也可以已经包含 `/agent-v2`。如果缺少
`/agent-v2`，SDK 会在发送请求前自动补上。

`X-User-ID` 用于 `tools`、`skills`、`agents` 的注册和更新接口，`agent-gateway` 会用它写入 provider、owner 和操作人字段。也可以通过 `headers` 配置其他全局请求头。

列表接口的筛选字段与 CLI/gateway 保持兼容：常用字段包括 `search`、`status`、`provider`、`public`、`limit`、`offset`；兼容字段包括 `sourceKind`、`ownerId`、`category`。分页行为与 CLI 一致：`limit` 省略或 `<= 0` 时默认 20，`> 200` 时由 gateway 封顶为 200，`offset` 从 0 开始。

## 基础示例

查询工具列表：

```js
const tools = await client.tools.list({
  provider: "web-tools-mcp",
  status: "active",
  limit: 20,
});

console.log(tools);
```

普通非流式聊天：

```js
const result = await client.chat.run({
  agentId: "33333333-3333-4333-8333-333333333333",
  message: "Search recent AI news and summarize the top 3 items.",
});

console.log(result);
```

使用多轮消息：

```js
const result = await client.chat.run({
  agentId: "33333333-3333-4333-8333-333333333333",
  messages: [
    { role: "system", content: "Answer in concise Chinese." },
    { role: "user", content: "Fetch https://example.com and explain what it is." },
  ],
});

console.log(result);
```

带请求元数据和自定义 Header 的聊天：

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

console.log(result);
```

`request_id`、`category`、`metadata` 会进入 `agent-gateway` 的 chat 请求体；自定义 Headers 会透传给 agent-worker，SSE 和 WebSocket 创建聊天时都支持。

## SSE 流式聊天

SSE 是默认流式传输方式，底层使用 HTTP `text/event-stream`，适合大多数 HTTP 网关和代理场景。

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
      // 可用于记录日志、统计指标、处理工具调用事件等。
    },
  },
);

console.log("\n\nFinal text:", text);
```

## WebSocket 流式聊天

如果调用方希望使用持久连接，或者运行环境已经统一管理 WebSocket 生命周期，可以将 `transport` 切换为 `"ws"`。

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

## 订阅已有 Chat

如果 Chat 由其他进程、浏览器页面或 CLI 创建，可以通过 Chat ID 继续订阅后续事件。`afterSeq` 用于从指定事件序号之后恢复。

SSE：

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

WebSocket：

```js
const chatId = "chat_xxxxxxxxxxxxx";

const text = await client.chat.stream(
  chatId,
  {
    transport: "ws",
    onTextDelta(delta, event) {
      process.stdout.write(delta);
    },
  },
  {
    afterSeq: 10,
  },
);

console.log("\n\nReceived text:", text);
```

## 使用内联 Agent 配置

如果不想引用已注册的 Agent ID，可以直接传入 `agentConfig`。`temperature`、`max_turns`、`timeout` 等运行时字段会由 `agent-gateway` 透传给 agent-worker：

```js
const result = await client.chat.run({
  category: "fabric",
  agentConfig: {
    agent: {
      name: "inline-assistant",
      model: "gpt-4.1-mini",
      temperature: 0.2,
      max_turns: 6,
      timeout: 120,
      system_prompt: "Answer in Chinese and keep the answer brief.",
    },
  },
  message: "Explain what agent-gateway does.",
});

console.log(result);
```

如果 Agent 需要由 `agent-gateway` 自动拉起 sandbox，可以在 `agentConfig` 中声明 `runtime.sandbox.sandbox_template`。当前支持的模板枚举为 `react-game` 和 `react-web`：

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

console.log(result);
```

## 注册 Tool、Skill 和 Agent

`agent-gateway` 现在用服务端生成的 UUID `id` 作为唯一资源身份。注册表资源查找和关联都使用 UUID；不要在 payload 中传已经移除的 `tool_key`、`skill_key`、`agent_key` 字段。

注册工具：

```js
const tool = await client.tools.register({
  name: "search_web",
  description: "Search public web pages.",
  runtime_type: "http",
  endpoint: "https://example.com/tools/search",
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

console.log(tool);
```

注册技能：

```js
const skill = await client.skills.register({
  name: "web_research",
  description: "Research a topic with web tools.",
  instruction: "Search, compare sources, and summarize findings.",
  required_tools: [
    { ref: "22222222-2222-4222-8222-222222222222" },
  ],
  enabled: true,
  public: false,
});

console.log(skill);
```

注册 Agent：

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

console.log(agent);
```

## 注册 Hook endpoint

```js
const hook = await client.hooks.register({
  name: "production-line-hook",
  endpoint: "https://example.com/agent-hook",
  description: "Receives Agent Worker events for the configured API key.",
  metadata: {},
});

console.log(hook);
```

Hook 使用 `apiKey` 作为 `Authorization: Bearer ...`，payload 中不要传 `api_key`。Worker 固定用 `POST` 调用 endpoint，业务方按事件 payload 中的 `event_id` 自行过滤。

## 资源接口

- `client.system.health()`
- `client.system.metrics()`
- `client.catalog.list(options)`
- `client.tools.register(payload)`
- `client.tools.list(options)`
- `client.tools.get(toolId)`
- `client.tools.update(toolId, payload)`
- `client.tools.delete(toolId, options)`，`options.operatorId` 会作为兼容查询参数透传；实际鉴权仍建议通过 `X-User-ID` header 配置。
- `client.tools.resolve(toolId)`
- `client.skills.register(payload)`
- `client.skills.list(options)`
- `client.skills.get(skillId)`
- `client.skills.update(skillId, payload)`
- `client.skills.delete(skillId, options)`，`options.operatorId` 会作为兼容查询参数透传；实际鉴权仍建议通过 `X-User-ID` header 配置。
- `client.agents.register(payload)`
- `client.agents.list(options)`
- `client.agents.get(agentId)`
- `client.agents.update(agentId, payload)`
- `client.agents.delete(agentId, options)`，`options.operatorId` 会作为兼容查询参数透传；实际鉴权仍建议通过 `X-User-ID` header 配置。
- `client.agents.capabilities(agentId)`
- `client.hooks.register(payload)`
- `client.hooks.list(options)`
- `client.hooks.get(hookId)`
- `client.hooks.update(hookId, payload)`
- `client.hooks.delete(hookId)`
- `client.chat.createCompletion(payload)`
- `client.chat.streamCompletion(payload, handlers)`
- `client.chat.run(options)`
- `client.chat.runStream(options, handlers)`
- `client.chat.get(chatId)`
- `client.chat.events(chatId, options)`
- `client.chat.stream(chatId, handlers, options)`
- `client.chat.cancel(chatId)`

## 流事件工具函数

如果需要自行处理原始流数据，包内也导出了这些工具函数：

```js
import {
  createChatStreamProcessor,
  parseSSE,
  parseWebSocketEvent,
  textFromStreamEvent,
} from "sea-agent-sdk-js";
```

## 调试

设置环境变量后，SDK 会打印发出的 HTTP 和 WebSocket 请求：

```bash
export SEAAGENT_DEBUG=1
```
