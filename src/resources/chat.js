import { createChatStreamProcessor } from "../stream.js";

export class ChatResource {
  constructor(transport) {
    this.transport = transport;
  }

  async createCompletion(payload) {
    const { headers, body } = splitPayloadHeaders(payload);
    return this.transport.post("/v1/chat/completions", body, headers);
  }

  async streamCompletion(payload, handlers = {}) {
    const processor = createChatStreamProcessor(handlers);
    const streamPayload = {
      ...payload,
      stream: true,
    };
    const { headers, body } = splitPayloadHeaders(streamPayload);

    if (handlers.transport === "ws") {
      await this.transport.websocket(
        "/v1/chat/completions/ws",
        undefined,
        body,
        processor.writeWebSocketMessage,
        headers,
      );
    } else {
      await this.transport.postStream(
        "/v1/chat/completions",
        body,
        processor.writeSSEChunk,
        headers,
      );
    }

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
    const processor = createChatStreamProcessor(handlers);

    if (handlers.transport === "ws") {
      await this.transport.websocket(
        `/v1/chats/${encodeURIComponent(chatId)}/ws`,
        {
          after_seq: options.afterSeq ?? 0,
        },
        undefined,
        processor.writeWebSocketMessage,
      );
    } else {
      await this.transport.getStream(
        `/v1/chats/${encodeURIComponent(chatId)}/stream`,
        {
          after_seq: options.afterSeq ?? 0,
        },
        processor.writeSSEChunk,
      );
    }

    return processor.end();
  }

  async cancel(chatId) {
    return this.transport.post(`/v1/chats/${encodeURIComponent(chatId)}/cancel`);
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
