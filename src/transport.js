import { request } from "undici";
import WebSocket from "ws";

const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;

export class SeaAgentTransport {
  constructor(endpoint, apiKey, headers = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    this.endpoint = normalizeAgentGatewayEndpoint(endpoint);
    this.apiKey = apiKey;
    this.headers = { ...headers };
    this.timeoutMs = normalizeTimeoutMs(timeoutMs);
  }

  async get(path, query) {
    return this.requestJSON("GET", this.buildURL(path, query));
  }

  async getText(path, query) {
    return this.requestText("GET", this.buildURL(path, query));
  }

  async getStream(path, query, onChunk, options = {}) {
    await this.requestStream(
      "GET",
      this.buildURL(path, query),
      undefined,
      onChunk,
      options.headers,
      options.signal,
    );
  }

  async post(path, body, headers) {
    return this.requestJSON("POST", this.buildURL(path), body, headers);
  }

  async postText(path, body, headers) {
    return this.requestText("POST", this.buildURL(path), body, "*/*", headers);
  }

  async postStream(path, body, onChunk, headers, options = {}) {
    await this.requestStream("POST", this.buildURL(path), body, onChunk, headers, options.signal);
  }

  async put(path, body) {
    return this.requestJSON("PUT", this.buildURL(path), body);
  }

  async delete(path, query) {
    return this.requestJSON("DELETE", this.buildURL(path, query));
  }

  async websocket(path, query, initialMessage, onMessage, headers, options = {}) {
    const url = this.buildWebSocketURL(path, query);
    const requestHeaders = this.buildHeaders("*/*", false, headers);
    throwIfAborted(options.signal);
    if (isDebugEnabled()) {
      console.error(`WS ${url}`);
    }

    await new Promise((resolve, reject) => {
      let settled = false;
      let opened = false;
      const ws = new WebSocket(url, { headers: requestHeaders });

      const settle = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        options.signal?.removeEventListener("abort", onAbort);
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };

      const onAbort = () => {
        settle(abortError(options.signal));
        terminateWebSocket(ws);
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });

      ws.once("open", () => {
        opened = true;
        if (initialMessage !== undefined) {
          ws.send(JSON.stringify(initialMessage));
        }
      });

      ws.on("message", (data) => {
        try {
          onMessage(webSocketMessageToString(data));
        } catch (error) {
          const streamError = error instanceof Error ? error : new Error(String(error));
          closeWebSocket(ws, streamError.terminal === true ? 1000 : 1011);
          settle(streamError);
        }
      });

      ws.once("unexpected-response", (_request, response) => {
        const statusCode = response.statusCode;
        const message = response.statusMessage || "websocket handshake failed";
        response.resume();
        settle(new SeaAgentHTTPError(statusCode, message));
        terminateWebSocket(ws);
      });

      ws.once("error", (error) => {
        settle(error instanceof Error ? error : new Error(String(error)));
      });

      ws.once("close", (code, reason) => {
        const reasonText = webSocketMessageToString(reason);
        if (!opened) {
          settle(new Error(`websocket connection closed before open: ${code} ${reasonText}`.trim()));
          return;
        }
        if (code !== 1000 && code !== 1005) {
          settle(new Error(`websocket connection closed: ${code} ${reasonText}`.trim()));
          return;
        }
        settle();
      });
    });
  }

  buildURL(path, query) {
    const base = new URL(this.endpoint);
    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    const relativePath = path.replace(/^\/+/, "");
    base.pathname = `${basePath}${relativePath}`.replace(/\/{2,}/g, "/");
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        base.searchParams.set(key, String(value));
      }
    }
    return base.toString();
  }

  buildWebSocketURL(path, query) {
    const url = new URL(this.buildURL(path, query));
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    }
    return url.toString();
  }

  async requestJSON(method, url, body, headers) {
    const text = await this.requestText(method, url, body, "application/json", headers);
    return parseJSONResponse(text, url);
  }

  async requestText(method, url, body, accept = "*/*", requestHeaders) {
    const { headers, payload } = this.buildRequest(method, url, body, accept, requestHeaders);
    const response = await request(url, {
      method,
      headers,
      body: payload,
      signal: this.timeoutMs === 0 ? undefined : AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.body.text();
    if (response.statusCode >= 400) {
      throw new SeaAgentHTTPError(response.statusCode, errorMessageFromResponse(text));
    }
    return text;
  }

  async requestStream(method, url, body, onChunk, requestHeaders, signal) {
    const { headers, payload } = this.buildRequest(method, url, body, "text/event-stream", requestHeaders);
    const response = await request(url, {
      method,
      headers,
      body: payload,
      signal,
    });
    if (response.statusCode >= 400) {
      const text = await response.body.text();
      throw new SeaAgentHTTPError(response.statusCode, errorMessageFromResponse(text));
    }

    const decoder = new TextDecoder();
    try {
      for await (const chunk of response.body) {
        onChunk(decoder.decode(chunk, { stream: true }));
      }
      const rest = decoder.decode();
      if (rest) {
        onChunk(rest);
      }
    } finally {
      if (!response.body.destroyed) {
        response.body.destroy();
      }
    }
  }

  buildRequest(method, url, body, accept = "*/*", requestHeaders) {
    const headers = this.buildHeaders(accept, body !== undefined, requestHeaders);
    let payload;

    if (body !== undefined) {
      payload = JSON.stringify(body);
    }

    if (isDebugEnabled()) {
      console.error(`${method} ${url}`);
    }

    return { headers, payload };
  }

  buildHeaders(accept = "*/*", hasBody = false, requestHeaders = {}) {
    const headers = {
      ...(accept ? { accept } : {}),
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...this.headers,
      ...(requestHeaders ?? {}),
    };

    if (this.apiKey && !hasHeader(headers, "authorization")) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }
}

export class SeaAgentHTTPError extends Error {
  constructor(statusCode, message) {
    super(`${statusCode}: ${message}`);
    this.name = "SeaAgentHTTPError";
    this.statusCode = statusCode;
  }
}

export function normalizeAgentGatewayEndpoint(endpoint) {
  if (typeof endpoint !== "string") {
    return endpoint;
  }
  if (endpoint.trim() === "") {
    return endpoint;
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return endpoint;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (!segments.includes("agent-v2")) {
    segments.push("agent-v2");
  }
  url.pathname = `/${segments.join("/")}`;
  return url.toString();
}

function hasHeader(headers, name) {
  const lowerName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerName);
}

function normalizeTimeoutMs(timeoutMs) {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("timeoutMs must be a non-negative finite number");
  }
  return timeoutMs;
}

function isDebugEnabled() {
  return process.env.SEAAGENT_DEBUG === "1";
}

function errorMessageFromResponse(text) {
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }

  if (typeof parsed === "object" && parsed && "error" in parsed) {
    return String(parsed.error);
  }

  return text;
}

function parseJSONResponse(text, url) {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`expected JSON response from ${url}, got: ${preview}`);
  }
}

function webSocketMessageToString(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return String(data);
}

function closeWebSocket(ws, code) {
  if (ws.readyState !== WebSocket.OPEN) {
    terminateWebSocket(ws);
    return;
  }
  ws.close(code);
  const timeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.CLOSED) {
      terminateWebSocket(ws);
    }
  }, 250);
  timeout.unref?.();
}

function terminateWebSocket(ws) {
  try {
    ws.terminate();
  } catch {
    // The socket may already be closed by a concurrent error or abort.
  }
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
