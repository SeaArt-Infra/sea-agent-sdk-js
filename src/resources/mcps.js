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
}
