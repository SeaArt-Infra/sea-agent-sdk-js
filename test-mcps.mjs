import assert from "node:assert/strict";
import test from "node:test";
import { McpsResource } from "./src/resources/mcps.js";

test("MCP resource methods use the gateway management routes", async () => {
  const requests = [];
  const mcps = new McpsResource({
    async get(path, query) {
      requests.push({ method: "GET", path, query });
    },
    async post(path, body) {
      requests.push({ method: "POST", path, body });
    },
    async put(path, body) {
      requests.push({ method: "PUT", path, body });
    },
    async delete(path) {
      requests.push({ method: "DELETE", path });
    },
  });
  const server = { name: "sea-search", server_url: "https://mcp.example.com/mcp" };
  const call = { name: "search", arguments: { query: "hello" } };

  await mcps.register(server);
  await mcps.list({ status: "active", includeDeleted: true, limit: 10 });
  await mcps.get("mcp/1");
  await mcps.update("mcp-1", server);
  await mcps.delete("mcp-1");
  await mcps.tools("mcp-1");
  await mcps.call("mcp-1", call);

  assert.deepEqual(requests, [
    { method: "POST", path: "/v1/mcps/register", body: server },
    {
      method: "GET",
      path: "/v1/mcps",
      query: {
        search: undefined,
        status: "active",
        public: undefined,
        provider: undefined,
        include_deleted: true,
        limit: 10,
        offset: undefined,
      },
    },
    { method: "GET", path: "/v1/mcps/mcp%2F1", query: undefined },
    { method: "PUT", path: "/v1/mcps/mcp-1", body: server },
    { method: "DELETE", path: "/v1/mcps/mcp-1" },
    { method: "GET", path: "/v1/mcps/mcp-1/tools", query: undefined },
    { method: "POST", path: "/v1/mcps/mcp-1/call", body: call },
  ]);
});
