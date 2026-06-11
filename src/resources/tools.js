export class ToolsResource {
  constructor(transport) {
    this.transport = transport;
  }

  async register(payload) {
    return this.transport.post("/v1/tools/register", payload);
  }

  async list(options = {}) {
    return this.transport.get("/v1/tools", {
      search: options.search,
      status: options.status,
      source_kind: options.sourceKind,
      owner_id: options.ownerId,
      public: options.public,
      provider: options.provider,
      category: options.category,
      include_deleted: options.includeDeleted,
      limit: options.limit,
      offset: options.offset,
    });
  }

  async get(toolId) {
    return this.transport.get(`/v1/tools/${encodeURIComponent(toolId)}`);
  }

  async update(toolId, payload) {
    return this.transport.put(`/v1/tools/${encodeURIComponent(toolId)}`, payload);
  }

  async delete(toolId) {
    return this.transport.delete(`/v1/tools/${encodeURIComponent(toolId)}`);
  }

  async resolve(toolId) {
    return this.transport.get(`/v1/tools/${encodeURIComponent(toolId)}/resolve`);
  }
}
