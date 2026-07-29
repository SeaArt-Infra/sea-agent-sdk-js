import { randomUUID } from "node:crypto";
import { createChatStreamProcessor, StreamConsumerError } from "../stream.js";

const DEFAULT_MAX_RECONNECTS = 3;
const DEFAULT_RECONNECT_DELAY_MS = 250;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 5_000;

export class ChatResource {
  constructor(transport) {
    this.transport = transport;
  }

  async createCompletion(payload) {
    const { headers, body } = splitPayloadHeaders(payload);
    return this.transport.post("/v1/chat/completions", body, headers);
  }

  async streamCompletion(payload, handlers = {}) {
    const requestId = typeof payload.request_id === "string" ? payload.request_id.trim() : "";
    const streamPayload = {
      ...payload,
      request_id: requestId || randomUUID(),
      stream: true,
    };
    const { headers, body } = splitPayloadHeaders(streamPayload);
    const processor = createChatStreamProcessor(handlers);

    await consumeStreamWithResume(this.transport, processor, handlers, {
      createBody: body,
      headers,
    });
    return processor.end();
  }

  async run(options) {
    return this.createCompletion(buildRunPayload(options, false));
  }

  async runStream(options, handlers = {}) {
    return this.streamCompletion(buildRunPayload(options, true), handlers);
  }

  async get(chatId) {
    return this.transport.get(`/v1/chats/${encodeURIComponent(chatId)}`);
  }

  async events(chatId, options = {}) {
    return this.transport.get(`/v1/chats/${encodeURIComponent(chatId)}/events`, {
      after_seq: options.afterSeq ?? 0,
      limit: options.limit ?? 100,
    });
  }

  async stream(chatId, handlers = {}, options = {}) {
    const processor = createChatStreamProcessor(handlers, {
      runId: chatId,
      lastSeq: options.afterSeq,
    });

    await consumeStreamWithResume(this.transport, processor, handlers);
    return processor.end();
  }

  async cancel(chatId) {
    return this.transport.post(`/v1/chats/${encodeURIComponent(chatId)}/cancel`);
  }
}

async function consumeStreamWithResume(transport, processor, handlers, create = {}) {
  const reconnect = reconnectOptions(handlers);
  let reconnects = 0;

  while (true) {
    throwIfAborted(reconnect.signal);
    let connectionError;

    try {
      await openStreamConnection(transport, processor, handlers.transport, create, reconnect.signal);
      processor.discardIncompleteSSE();
      if (processor.terminal) {
        return;
      }
      if (!reconnect.autoResume) {
        return;
      }
      connectionError = new StreamDisconnectedError("stream ended before a terminal event");
    } catch (error) {
      processor.discardIncompleteSSE();
      if (processor.terminal) {
        return;
      }
      connectionError = error;
    }

    if (
      !reconnect.autoResume ||
      !shouldRetryStream(connectionError, reconnect.signal) ||
      reconnects >= reconnect.maxReconnects
    ) {
      throw connectionError;
    }

    reconnects += 1;
    const delayMs = Math.min(
      reconnect.maxReconnectDelayMs,
      reconnect.reconnectDelayMs * 2 ** (reconnects - 1),
    );
    notifyReconnect(handlers.onReconnect, {
      attempt: reconnects,
      delayMs,
      runId: processor.runId || undefined,
      afterSeq: processor.lastSeq,
      error: connectionError,
    });
    await waitForReconnect(delayMs, reconnect.signal);
  }
}

async function openStreamConnection(transport, processor, streamTransport, create, signal) {
  const writeSSEChunk = stopAfterTerminal(processor, processor.writeSSEChunk);
  const writeWebSocketMessage = stopAfterTerminal(processor, processor.writeWebSocketMessage);

  if (processor.runId || !create.createBody) {
    const path = `/v1/chats/${encodeURIComponent(processor.runId)}`;
    if (streamTransport === "ws") {
      await transport.websocket(
        `${path}/ws`,
        { after_seq: processor.lastSeq },
        undefined,
        writeWebSocketMessage,
        create.headers,
        { signal },
      );
      return;
    }
    await transport.getStream(
      `${path}/stream`,
      { after_seq: processor.lastSeq },
      writeSSEChunk,
      { headers: create.headers, signal },
    );
    return;
  }

  if (streamTransport === "ws") {
    await transport.websocket(
      "/v1/chat/completions/ws",
      undefined,
      create.createBody,
      writeWebSocketMessage,
      create.headers,
      { signal },
    );
    return;
  }
  await transport.postStream(
    "/v1/chat/completions",
    create.createBody,
    writeSSEChunk,
    create.headers,
    { signal },
  );
}

function stopAfterTerminal(processor, write) {
  return (value) => {
    write(value);
    if (processor.terminal) {
      throw new StreamTerminalSignal();
    }
  };
}

function reconnectOptions(handlers) {
  return {
    autoResume: handlers.autoResume !== false,
    maxReconnects: nonNegativeInteger(handlers.maxReconnects, DEFAULT_MAX_RECONNECTS),
    reconnectDelayMs: nonNegativeNumber(handlers.reconnectDelayMs, DEFAULT_RECONNECT_DELAY_MS),
    maxReconnectDelayMs: nonNegativeNumber(
      handlers.maxReconnectDelayMs,
      DEFAULT_MAX_RECONNECT_DELAY_MS,
    ),
    signal: handlers.signal,
  };
}

function shouldRetryStream(error, signal) {
  if (signal?.aborted || error?.name === "AbortError" || error?.retryable === false) {
    return false;
  }
  if (typeof error?.statusCode === "number") {
    return error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500;
  }
  return true;
}

function notifyReconnect(onReconnect, details) {
  if (!onReconnect) {
    return;
  }
  try {
    onReconnect(details);
  } catch (error) {
    throw new StreamConsumerError("stream reconnect handler failed", error);
  }
}

function waitForReconnect(delayMs, signal) {
  throwIfAborted(signal);
  if (delayMs === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

function abortError(signal) {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function nonNegativeNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

class StreamDisconnectedError extends Error {
  constructor(message) {
    super(message);
    this.name = "StreamDisconnectedError";
    this.retryable = true;
  }
}

class StreamTerminalSignal extends Error {
  constructor() {
    super("stream reached a terminal event");
    this.name = "StreamTerminalSignal";
    this.retryable = false;
    this.terminal = true;
  }
}

function buildRunPayload(options, stream) {
  if (!options.agentId && !options.agentConfig) {
    throw new Error("agentId or agentConfig is required");
  }

  const messages = normalizeMessages(options.message, options.messages);
  return {
    ...(options.requestId ? { request_id: options.requestId } : {}),
    ...(options.agentId ? { agent_id: options.agentId } : {}),
    ...(options.category ? { category: options.category } : {}),
    ...(options.agentConfig ? { agent_config: options.agentConfig } : {}),
    ...(Array.isArray(options.skillIds) && options.skillIds.length > 0 ? { skill_ids: options.skillIds } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
    ...(options.extraBody ?? {}),
    ...(options.headers ? { headers: options.headers } : {}),
    messages,
    stream,
  };
}

function normalizeMessages(message, messages) {
  if (messages && messages.length > 0) {
    return messages;
  }
  return [{ role: "user", content: message ?? "" }];
}

function splitPayloadHeaders(payload) {
  const { headers, ...body } = payload;
  return { headers, body };
}
