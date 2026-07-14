/**
 * @typedef {Object} HookRequest
 * @property {string} name
 * @property {string} endpoint
 * @property {string} description
 */

export class HooksResource {
  constructor(transport) {
    this.transport = transport;
  }

  /** @param {HookRequest} payload */
  async register(payload) {
    return this.transport.post("/v1/hooks/register", payload);
  }

  /** @param {HookRequest} payload */
  async update(payload) {
    return this.transport.put("/v1/hooks", payload);
  }

  async delete() {
    return this.transport.delete("/v1/hooks");
  }
}
