// The streamable-HTTP revision spoken by the gateway's standard MCP endpoint.
export const MCP_PROTOCOL_VERSION = "2025-03-26";

export class McpsResource {
  constructor(transport) {
    this.transport = transport;
  }

  async register(payload) {
    return this.transport.post("/v1/mcps/register", payload);
  }

  async list(options = {}) {
    return this.transport.get("/v1/mcps", {
      search: options.search,
      status: options.status,
      public: options.public,
      provider: options.provider,
      include_deleted: options.includeDeleted,
      limit: options.limit,
      offset: options.offset,
    });
  }

  async get(mcpId) {
    return this.transport.get(`/v1/mcps/${encodeURIComponent(mcpId)}`);
  }

  async update(mcpId, payload) {
    return this.transport.put(`/v1/mcps/${encodeURIComponent(mcpId)}`, payload);
  }

  async delete(mcpId) {
    return this.transport.delete(`/v1/mcps/${encodeURIComponent(mcpId)}`);
  }

  async tools(mcpId) {
    return this.transport.get(`/v1/mcps/${encodeURIComponent(mcpId)}/tools`);
  }

  async call(mcpId, payload) {
    return this.transport.post(`/v1/mcps/${encodeURIComponent(mcpId)}/call`, payload);
  }

  /**
   * Endpoint and headers for talking MCP to a registered server through the
   * gateway. Returns connection details rather than a client: the gateway
   * endpoint is standard streamable-HTTP, so pair this with an official MCP SDK
   * client instead of a hand-rolled JSON-RPC layer.
   *
   * Upstream registry credentials are injected by the gateway and never appear
   * in these headers.
   *
   * @example
   * const { url, headers } = client.mcps.connectionInfo(mcpId);
   * const transport = new StreamableHTTPClientTransport(new URL(url), {
   *   requestInit: { headers },
   * });
   * await new Client({ name: "app", version: "1.0" }).connect(transport);
   */
  connectionInfo(mcpId) {
    return {
      url: this.transport.buildURL(`/v1/mcps/${encodeURIComponent(mcpId)}/mcp`),
      // Reuse the transport's own auth and custom-header rules so the proxy
      // path cannot drift from the REST paths.
      headers: {
        ...this.transport.buildHeaders("application/json, text/event-stream", true),
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      },
    };
  }
}
