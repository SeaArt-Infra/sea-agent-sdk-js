export class AgentsResource {
  constructor(transport) {
    this.transport = transport;
  }

  async register(payload) {
    return this.transport.post("/v1/agents/register", payload);
  }

  async update(agentId, payload) {
    return this.transport.put(`/v1/agents/${encodeURIComponent(agentId)}`, payload);
  }

  async list(options = {}) {
    return this.transport.get("/v1/agents", {
      search: options.search,
      status: options.status,
      owner_id: options.ownerId,
      category: options.category,
      include_deleted: options.includeDeleted,
      limit: options.limit,
      offset: options.offset,
    });
  }

  async get(agentId) {
    return this.transport.get(`/v1/agents/${encodeURIComponent(agentId)}`);
  }

  async delete(agentId) {
    return this.transport.delete(`/v1/agents/${encodeURIComponent(agentId)}`);
  }

  async capabilities(agentId) {
    return this.transport.get(`/v1/agents/${encodeURIComponent(agentId)}/capabilities`);
  }
}
