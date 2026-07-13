import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { WebSocketServer } from "ws";
import { ChatResource } from "./src/resources/chat.js";
import {
  createChatStreamProcessor,
  parseSSE,
  parseWebSocketEvent,
  StreamConsumerError,
} from "./src/stream.js";
import { SeaAgentHTTPError, SeaAgentTransport } from "./src/transport.js";

test("SSE and WebSocket events expose id and numeric seq", () => {
  assert.deepEqual(parseSSE('event: chat.delta\ndata: {"content":"hi"}\nid: 12'), [
    { id: "12", seq: 12, event: "chat.delta", data: { content: "hi" } },
  ]);
  assert.deepEqual(parseSSE('event: heartbeat\ndata: {"ok":true}'), [
    { id: "", seq: 0, event: "heartbeat", data: { ok: true } },
  ]);
  assert.deepEqual(
    parseWebSocketEvent('{"id":"13","event":"chat.delta","data":{"text":"there"}}'),
    { id: "13", seq: 13, event: "chat.delta", data: { text: "there" } },
  );
});

test("processor deduplicates seq, supports chat.delta, and discards partial frames", () => {
  const events = [];
  const deltas = [];
  const processor = createChatStreamProcessor({
    onEvent(event) {
      events.push(event);
    },
    onTextDelta(delta, event) {
      deltas.push([delta, event.seq]);
    },
  });

  processor.writeSSEChunk(sse(1, "chat.created", { run_id: "run_1" }));
  processor.writeSSEChunk(sse(2, "chat.delta", { content: "hello" }));
  processor.writeSSEChunk(sse(2, "chat.delta", { content: "duplicate" }));
  processor.writeSSEChunk('event: chat.delta\ndata: {"content":"partial');
  processor.discardIncompleteSSE();
  processor.writeWebSocketMessage(
    JSON.stringify({ id: "3", event: "chat.delta", data: { delta: " world" } }),
  );
  processor.writeWebSocketMessage(
    JSON.stringify({ id: "4", event: "response.completed", data: {} }),
  );
  processor.writeSSEChunk(sse(5, "chat.delta", { content: " after terminal" }));
  processor.writeWebSocketMessage(
    JSON.stringify({ id: "6", event: "chat.delta", data: { content: " ignored" } }),
  );

  assert.equal(processor.end(), "hello world");
  assert.equal(processor.runId, "run_1");
  assert.equal(processor.lastSeq, 4);
  assert.equal(processor.terminal, true);
  assert.deepEqual(events.map((event) => event.seq), [1, 2, 3, 4]);
  assert.deepEqual(deltas, [["hello", 2], [" world", 3]]);
});

test("processor recognizes gateway terminal aliases", () => {
  for (const eventName of ["chat.completed", "response.canceled"]) {
    const processor = createChatStreamProcessor();
    processor.writeSSEChunk(sse(1, eventName, {}));
    assert.equal(processor.terminal, true, eventName);
    assert.equal(processor.lastSeq, 1, eventName);
  }

  const events = [];
  const processor = createChatStreamProcessor({ onEvent: (event) => events.push(event) });
  processor.writeSSEChunk(
    sse(1, "chat.completed", {}) +
      sse(2, "chat.delta", { content: "must not be delivered" }),
  );
  assert.deepEqual(events.map((event) => event.seq), [1]);
  assert.equal(processor.lastSeq, 1);
  assert.equal(processor.end(), "");
});

test("SSE stream returns after terminal event without waiting for server EOF", async (t) => {
  let resolveClosed;
  const responseClosed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const server = createServer((request, response) => {
    request.resume();
    response.on("close", resolveClosed);
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(
      sse(1, "chat.created", { run_id: "run_open_sse" }) +
        sse(2, "chat.completed", {}),
    );
  });
  await listen(server);
  t.after(() => closeServer(server));

  const address = server.address();
  const chat = new ChatResource(
    new SeaAgentTransport(`http://127.0.0.1:${address.port}`, "test-key"),
  );
  const text = await withTimeout(
    chat.runStream({ agentId: "agent_1", message: "hello" }),
  );

  assert.equal(text, "");
  await withTimeout(responseClosed);
});

test("WebSocket stream returns after terminal event without waiting for server close", async (t) => {
  let resolveClosed;
  const clientClosed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  const server = createServer();
  const websocketServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });
  websocketServer.on("connection", (websocket) => {
    websocket.on("close", resolveClosed);
    websocket.once("message", () => {
      websocket.send(JSON.stringify({ id: "1", event: "chat.created", data: { run_id: "run_open_ws" } }));
      websocket.send(JSON.stringify({ id: "2", event: "response.canceled", data: {} }));
    });
  });
  await listen(server);
  t.after(async () => {
    await closeWebSocketServer(websocketServer);
    await closeServer(server);
  });

  const address = server.address();
  const chat = new ChatResource(
    new SeaAgentTransport(`http://127.0.0.1:${address.port}`, "test-key"),
  );
  const text = await withTimeout(
    chat.runStream(
      { agentId: "agent_1", message: "hello" },
      { transport: "ws" },
    ),
  );

  assert.equal(text, "");
  await withTimeout(clientClosed);
});

test("WebSocket handshake retries only transient HTTP statuses", async (t) => {
  let statusCode = 400;
  let calls = 0;
  const server = createServer();
  server.on("upgrade", (_request, socket) => {
    calls += 1;
    const reason = statusCode === 400 ? "Bad Request" : "Service Unavailable";
    const body = JSON.stringify({ error: reason });
    socket.end(
      `HTTP/1.1 ${statusCode} ${reason}\r\n` +
        "Content-Type: application/json\r\n" +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        "Connection: close\r\n\r\n" +
        body,
    );
  });
  await listen(server);
  t.after(() => closeServer(server));

  const address = server.address();
  const chat = new ChatResource(
    new SeaAgentTransport(`http://127.0.0.1:${address.port}`, "test-key"),
  );
  await assert.rejects(
    chat.runStream(
      { agentId: "agent_1", message: "hello" },
      { transport: "ws", reconnectDelayMs: 0 },
    ),
    (error) => error instanceof SeaAgentHTTPError && error.statusCode === 400,
  );
  assert.equal(calls, 1);

  statusCode = 503;
  calls = 0;
  await assert.rejects(
    chat.runStream(
      { agentId: "agent_1", message: "hello" },
      { transport: "ws", maxReconnects: 1, reconnectDelayMs: 0 },
    ),
    (error) => error instanceof SeaAgentHTTPError && error.statusCode === 503,
  );
  assert.equal(calls, 2);
});

test("runStream resumes an interrupted HTTP SSE stream with after_seq", async (t) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "POST") {
      const body = JSON.parse(await readRequestBody(request));
      requests.push({ method: request.method, url, body, headers: request.headers });
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        sse(1, "chat.created", { run_id: "run_http" }) +
          sse(2, "chat.delta", { content: "hello" }),
      );
      return;
    }

    requests.push({ method: request.method, url, headers: request.headers });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      sse(2, "chat.delta", { content: "duplicate" }) +
        sse(3, "chat.delta", { content: " world" }) +
        sse(4, "response.completed", {}),
    );
  });
  await listen(server);
  t.after(() => server.close());

  const address = server.address();
  const transport = new SeaAgentTransport(`http://127.0.0.1:${address.port}`, "test-key");
  const chat = new ChatResource(transport);
  const reconnects = [];
  const text = await chat.runStream(
    { agentId: "agent_1", message: "hello", headers: { "X-Trace-ID": "trace_1" } },
    { reconnectDelayMs: 0, onReconnect: (details) => reconnects.push(details) },
  );

  assert.equal(text, "hello world");
  assert.equal(requests.length, 2);
  assert.match(requests[0].body.request_id, /^[0-9a-f-]{36}$/);
  assert.equal(requests[1].url.pathname, "/agent-v2/v1/chats/run_http/stream");
  assert.equal(requests[1].url.searchParams.get("after_seq"), "2");
  assert.equal(requests[0].headers["x-trace-id"], "trace_1");
  assert.equal(requests[1].headers["x-trace-id"], "trace_1");
  assert.deepEqual(
    reconnects.map(({ attempt, runId, afterSeq }) => ({ attempt, runId, afterSeq })),
    [{ attempt: 1, runId: "run_http", afterSeq: 2 }],
  );
});

test("runStream retries creation with one stable generated request_id before run id", async () => {
  const bodies = [];
  const chat = new ChatResource({
    async postStream(path, body, onChunk) {
      bodies.push({ path, body });
      if (bodies.length === 1) {
        throw new Error("connection reset");
      }
      onChunk(sse(1, "chat.created", { run_id: "run_2" }));
      onChunk(sse(2, "chat.delta", { text: "ok" }));
      onChunk(sse(3, "response.completed", {}));
    },
  });

  const text = await chat.runStream(
    { agentId: "agent_1", message: "hello" },
    { reconnectDelayMs: 0 },
  );

  assert.equal(text, "ok");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].body.request_id, bodies[1].body.request_id);
  assert.match(bodies[0].body.request_id, /^[0-9a-f-]{36}$/);
});

test("WebSocket stream resumes from the last delivered seq", async () => {
  const calls = [];
  const chat = new ChatResource({
    async websocket(path, query, initialMessage, onMessage) {
      calls.push({ path, query, initialMessage });
      if (calls.length === 1) {
        onMessage(JSON.stringify({ id: "1", event: "chat.created", data: { run_id: "run_ws" } }));
        onMessage(JSON.stringify({ id: "2", event: "chat.delta", data: { content: "a" } }));
        throw new Error("socket closed");
      }
      onMessage(JSON.stringify({ id: "3", event: "chat.delta", data: { content: "b" } }));
      onMessage(JSON.stringify({ id: "4", event: "chat.response", data: {} }));
    },
  });

  const text = await chat.runStream(
    { agentId: "agent_1", message: "hello", requestId: "req_1" },
    { transport: "ws", reconnectDelayMs: 0 },
  );

  assert.equal(text, "ab");
  assert.equal(calls[0].path, "/v1/chat/completions/ws");
  assert.equal(calls[0].initialMessage.request_id, "req_1");
  assert.equal(calls[1].path, "/v1/chats/run_ws/ws");
  assert.deepEqual(calls[1].query, { after_seq: 2 });
  assert.equal(calls[1].initialMessage, undefined);
});

test("autoResume false preserves one-shot clean EOF behavior", async () => {
  let calls = 0;
  const chat = new ChatResource({
    async postStream(path, body, onChunk) {
      calls += 1;
      onChunk(sse(1, "chat.delta", { content: "partial" }));
    },
  });

  const text = await chat.runStream(
    { agentId: "agent_1", message: "hello" },
    { autoResume: false },
  );
  assert.equal(text, "partial");
  assert.equal(calls, 1);
});

test("stream resumes an existing run after its initial afterSeq", async () => {
  const calls = [];
  const chat = new ChatResource({
    async getStream(path, query, onChunk) {
      calls.push({ path, query });
      if (calls.length === 1) {
        onChunk(sse(6, "chat.delta", { content: "a" }));
        throw new Error("connection reset");
      }
      onChunk(sse(6, "chat.delta", { content: "duplicate" }));
      onChunk(sse(7, "chat.delta", { content: "b" }));
      onChunk(sse(8, "response.completed", {}));
    },
  });

  const text = await chat.stream(
    "run_existing",
    { reconnectDelayMs: 0 },
    { afterSeq: 5 },
  );
  assert.equal(text, "ab");
  assert.deepEqual(calls, [
    { path: "/v1/chats/run_existing/stream", query: { after_seq: 5 } },
    { path: "/v1/chats/run_existing/stream", query: { after_seq: 6 } },
  ]);
});

test("maxReconnects limits retries and HTTP 4xx is not retried", async () => {
  let networkCalls = 0;
  const networkChat = new ChatResource({
    async postStream() {
      networkCalls += 1;
      throw new Error("network unavailable");
    },
  });
  await assert.rejects(
    networkChat.runStream(
      { agentId: "agent_1", message: "hello" },
      { maxReconnects: 1, reconnectDelayMs: 0 },
    ),
    /network unavailable/,
  );
  assert.equal(networkCalls, 2);

  let clientErrorCalls = 0;
  const clientError = new Error("bad request");
  clientError.statusCode = 400;
  const clientErrorChat = new ChatResource({
    async postStream() {
      clientErrorCalls += 1;
      throw clientError;
    },
  });
  await assert.rejects(
    clientErrorChat.runStream(
      { agentId: "agent_1", message: "hello" },
      { reconnectDelayMs: 0 },
    ),
    /bad request/,
  );
  assert.equal(clientErrorCalls, 1);
});

test("handler errors and AbortSignal are never retried", async () => {
  let handlerCalls = 0;
  const handlerChat = new ChatResource({
    async postStream(path, body, onChunk) {
      handlerCalls += 1;
      onChunk(sse(1, "chat.delta", { content: "x" }));
    },
  });
  await assert.rejects(
    handlerChat.runStream(
      { agentId: "agent_1", message: "hello" },
      {
        reconnectDelayMs: 0,
        onEvent() {
          throw new Error("callback failed");
        },
      },
    ),
    (error) => error instanceof StreamConsumerError && error.cause?.message === "callback failed",
  );
  assert.equal(handlerCalls, 1);

  const controller = new AbortController();
  let abortCalls = 0;
  const abortChat = new ChatResource({
    async postStream(path, body, onChunk, headers, options) {
      abortCalls += 1;
      controller.abort();
      throw options.signal.reason;
    },
  });
  await assert.rejects(
    abortChat.runStream(
      { agentId: "agent_1", message: "hello" },
      { signal: controller.signal, reconnectDelayMs: 0 },
    ),
    (error) => error === controller.signal.reason,
  );
  assert.equal(abortCalls, 1);
});

function sse(id, event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\nid: ${id}\n\n`;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function closeWebSocketServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function withTimeout(promise, timeoutMs = 1_000) {
  let timeout;
  const timed = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timed]).finally(() => clearTimeout(timeout));
}
