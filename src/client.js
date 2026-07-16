import { loadSeaAgentConfig } from "./config.js";
import { AgentsResource } from "./resources/agents.js";
import { CatalogResource } from "./resources/catalog.js";
import { ChatResource } from "./resources/chat.js";
import { HooksResource } from "./resources/hooks.js";
import { SkillsResource } from "./resources/skills.js";
import { SystemResource } from "./resources/system.js";
import { ToolsResource } from "./resources/tools.js";
import { normalizeAgentGatewayEndpoint, SeaAgentTransport } from "./transport.js";

export class SeaAgentClient {
  constructor(options) {
    this.endpoint = normalizeAgentGatewayEndpoint(options.endpoint);
    this.apiKey = options.apiKey;
    this.headers = options.headers;
    this.transport = new SeaAgentTransport(
      this.endpoint,
      options.apiKey,
      options.headers,
      options.timeoutMs,
    );
    this.timeoutMs = this.transport.timeoutMs;
    this.system = new SystemResource(this.transport);
    this.catalog = new CatalogResource(this.transport);
    this.tools = new ToolsResource(this.transport);
    this.skills = new SkillsResource(this.transport);
    this.agents = new AgentsResource(this.transport);
    this.hooks = new HooksResource(this.transport);
    this.chat = new ChatResource(this.transport);
  }

  static async fromConfig(path) {
    const config = await loadSeaAgentConfig(path);
    if (!config.endpoint) {
      throw new Error("endpoint is not configured. Expected ~/.seaagent/config.yaml or a custom config path.");
    }

    return new SeaAgentClient({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      headers: headersFromConfig(config),
    });
  }
}

function headersFromConfig(config) {
  return config.userId ? { "X-User-ID": config.userId } : undefined;
}
