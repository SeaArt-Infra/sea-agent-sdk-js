const TERMINAL_EVENTS = new Set([
  "response.completed",
  "response.failed",
  "response.cancelled",
  "response.canceled",
  "chat.response",
  "chat.completed",
  "chat.failed",
  "chat.cancelled",
]);

export class StreamConsumerError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "StreamConsumerError";
    this.retryable = false;
  }
}

export function createChatStreamProcessor(handlers = {}, initialState = {}) {
  let buffer = "";
  let text = "";
  let lastSeq = normalizeSeq(initialState.lastSeq);
  let runId = typeof initialState.runId === "string" ? initialState.runId : "";
  let terminal = false;

  const handleEvent = (event) => {
    if (terminal) {
      return;
    }
    if (event.seq > 0 && event.seq <= lastSeq) {
      return;
    }

    try {
      if (handlers.onEvent) {
        handlers.onEvent(event);
      }
      const delta = textFromStreamEvent(event);
      if (delta) {
        if (handlers.onTextDelta) {
          handlers.onTextDelta(delta, event);
        }
        text += delta;
      }
    } catch (error) {
      throw new StreamConsumerError("stream event handler failed", error);
    }

    if (event.event === "chat.created" && typeof event.data?.run_id === "string") {
      runId = event.data.run_id;
    }
    if (event.seq > 0) {
      lastSeq = event.seq;
    }
    if (TERMINAL_EVENTS.has(event.event)) {
      terminal = true;
    }
  };

  return {
    writeSSEChunk(chunk) {
      if (terminal) {
        return;
      }
      buffer += chunk;
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      try {
        eventLoop:
        for (const part of parts) {
          for (const event of parseSSE(part)) {
            handleEvent(event);
            if (terminal) {
              buffer = "";
              break eventLoop;
            }
          }
        }
      } catch (error) {
        if (error instanceof StreamConsumerError) {
          throw error;
        }
        throw new StreamConsumerError("failed to parse SSE event", error);
      }
    },
    writeWebSocketMessage(message) {
      if (terminal) {
        return;
      }
      try {
        handleEvent(parseWebSocketEvent(message));
      } catch (error) {
        if (error instanceof StreamConsumerError) {
          throw error;
        }
        throw new StreamConsumerError("failed to parse WebSocket event", error);
      }
    },
    discardIncompleteSSE() {
      buffer = "";
    },
    end() {
      return text;
    },
    get text() {
      return text;
    },
    get lastSeq() {
      return lastSeq;
    },
    get runId() {
      return runId;
    },
    get terminal() {
      return terminal;
    },
  };
}

export function parseSSE(text) {
  const events = [];
  for (const block of text.split(/\r?\n\r?\n+/)) {
    const lines = block.split(/\r?\n/);
    let id = "";
    let event = "message";
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith("id:")) {
        id = line.slice("id:".length).trim();
        continue;
      }
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    if (dataLines.length === 0) {
      continue;
    }

    const dataText = dataLines.join("\n");
    let data = dataText;
    try {
      data = JSON.parse(dataText);
    } catch {
      // Keep non-JSON data as raw text.
    }
    events.push({ id, seq: normalizeSeq(id), event, data });
  }

  return events;
}

export function parseWebSocketEvent(message) {
  let parsed;
  try {
    parsed = JSON.parse(message);
  } catch {
    return { id: "", seq: 0, event: "message", data: message };
  }

  if (!parsed || typeof parsed !== "object") {
    return { id: "", seq: 0, event: "message", data: parsed };
  }

  const event = typeof parsed.event === "string" && parsed.event ? parsed.event : "message";
  if (event === "error") {
    const code = typeof parsed.code === "string" && parsed.code ? `${parsed.code}: ` : "";
    const errorText = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed);
    throw new Error(`${code}${errorText}`);
  }

  const id = typeof parsed.id === "string" ? parsed.id : parsed.id == null ? "" : String(parsed.id);
  return { id, seq: normalizeSeq(id), event, data: parsed.data };
}

export function textFromStreamEvent(event) {
  if (event.event === "response.text.delta" || event.event === "response.output_text.delta") {
    return stringField(event.data, "delta");
  }
  if (event.event === "chat.response" || event.event === "chat.delta" || event.event === "message.delta") {
    return (
      stringField(event.data, "content") ||
      stringField(event.data, "text") ||
      stringField(event.data, "delta")
    );
  }
  return "";
}

function stringField(data, field) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const value = data[field];
  return typeof value === "string" ? value : "";
}

function normalizeSeq(value) {
  const seq = Number(value);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
}
