export class SkillsResource {
  constructor(transport) {
    this.transport = transport;
  }

  async register(payload) {
    return this.transport.post("/v1/skills/register", payload);
  }

  async list(options = {}) {
    return this.transport.get("/v1/skills", {
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

  async get(skillId) {
    return this.transport.get(`/v1/skills/${encodeURIComponent(skillId)}`);
  }

  async update(skillId, payload) {
    return this.transport.put(`/v1/skills/${encodeURIComponent(skillId)}`, payload);
  }

  async delete(skillId) {
    return this.transport.delete(`/v1/skills/${encodeURIComponent(skillId)}`);
  }
}
