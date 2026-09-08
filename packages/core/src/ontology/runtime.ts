import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENTITY_TYPES,
  ONTOLOGY_SCHEMA_VERSION,
  getToolId,
  type AgentDefinition,
  type AuthorizationDecision,
  type OntologyBundle,
  type OntologyId,
  type RuntimeId,
} from "@tori-agent/ontology";
import { OntologyCompiler } from "./compiler.js";
import { PolicyEngineImpl } from "../policy/engine.js";
import { JSONLDSerializer } from "../serialization/jsonld.js";

export interface RuntimeAgentConfig {
  description: string;
  temperature: number;
  mode: "all" | "subagent";
  color: string;
  prompt: string;
  tools: Record<string, boolean>;
  permission: Record<string, "allow" | "deny">;
}

export class OntologyRuntime {
  private readonly compiler: OntologyCompiler;
  private readonly serializer = new JSONLDSerializer();
  private initialized = false;
  private bundle: OntologyBundle | null = null;
  private policyEngine: PolicyEngineImpl | null = null;
  private readonly sessionAgents = new Map<string, OntologyId>();

  constructor(compiler = new OntologyCompiler()) {
    this.compiler = compiler;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.compiler.initialize();
    const result = await this.compiler.compileAll();
    if (result.errors.length > 0) {
      throw new Error(`Ontology compilation failed: ${result.errors.map((entry) => `${entry.specId}: ${entry.error}`).join(" | ")}`);
    }
    this.bundle = this.compiler.getRegistry().getBundle();
    this.policyEngine = new PolicyEngineImpl(this.bundle);
    await this.serializer.initialize();
    this.initialized = true;
  }

  getBundle(): OntologyBundle {
    this.assertInitialized();
    return this.bundle!;
  }

  getPolicyEngine(): PolicyEngineImpl {
    this.assertInitialized();
    return this.policyEngine!;
  }

  getRegistry() {
    return this.compiler.getRegistry();
  }

  getSchemaVersion(): string {
    return ONTOLOGY_SCHEMA_VERSION;
  }

  bindSession(sessionId: string, hostAgentName?: string): void {
    this.assertInitialized();
    if (!hostAgentName) return;
    const agentId = this.resolveAgentId(hostAgentName);
    if (agentId) {
      this.sessionAgents.set(sessionId, agentId);
    }
  }

  getBoundAgent(sessionId: string): OntologyId | undefined {
    return this.sessionAgents.get(sessionId);
  }

  unbindSession(sessionId: string): void {
    this.sessionAgents.delete(sessionId);
  }

  async buildRuntimeAgentConfigs(runtimeId: RuntimeId): Promise<Record<string, RuntimeAgentConfig>> {
    this.assertInitialized();
    const configs: Record<string, RuntimeAgentConfig> = {};
    for (const agent of this.bundle!.agents) {
      if (!agent.metadata.runtime_ids.includes(runtimeId)) continue;
      configs[this.toHostAgentKey(agent["@id"])] = {
        description: agent.description,
        temperature: agent.metadata.temperature,
        mode: agent.metadata.mode,
        color: agent.metadata.color,
        prompt: await this.loadPrompt(agent.prompt_ref),
        tools: this.buildToolsMap(agent),
        permission: this.buildHostPermission(agent),
      };
    }
    return configs;
  }

  authorizeSession(sessionId: string, toolName: string, pattern?: string | string[], runtimePaths?: Parameters<PolicyEngineImpl["authorize"]>[0]["runtimePaths"]): AuthorizationDecision {
    this.assertInitialized();
    const agentId = this.sessionAgents.get(sessionId);
    if (!agentId) {
      return { effect: "deny", matchedGrantIds: [], reason: `Session ${sessionId} not bound to ontology agent` };
    }
    if (!runtimePaths) {
      return { effect: "deny", matchedGrantIds: [], reason: "Missing runtime path context" };
    }
    return this.policyEngine!.authorize({
      agentId,
      toolName,
      toolId: getToolId(toolName),
      pattern,
      runtimePaths,
    });
  }

  async serializeAgent(agentId: OntologyId): Promise<string> {
    this.assertInitialized();
    const entity = this.bundle!.byId.get(agentId);
    if (!entity || entity["@type"] !== ENTITY_TYPES.Agent) {
      throw new Error(`Unknown agent ${agentId}`);
    }
    return this.serializer.serialize(entity);
  }

  getAgentsByCapability(capabilityId: OntologyId): AgentDefinition[] {
    this.assertInitialized();
    return this.bundle!.agents.filter((agent) => agent.capability_ids.includes(capabilityId));
  }

  agentHasCapability(agentId: OntologyId, capabilityId: OntologyId): boolean {
    this.assertInitialized();
    const agent = this.bundle!.agents.find((entry) => entry["@id"] === agentId);
    return Boolean(agent?.capability_ids.includes(capabilityId));
  }

  private assertInitialized(): void {
    if (!this.initialized || !this.bundle || !this.policyEngine) {
      throw new Error("OntologyRuntime not initialized");
    }
  }

  private resolveAgentId(hostAgentName: string): OntologyId | undefined {
    const exact = this.bundle!.agents.find((agent) => agent["@id"] === hostAgentName);
    if (exact) return exact["@id"];
    const prefixed = this.bundle!.agents.find((agent) => this.toHostAgentKey(agent["@id"]) === hostAgentName);
    return prefixed?.["@id"];
  }

  private async loadPrompt(promptRef: OntologyId): Promise<string> {
    const fileName = promptRef.replace("prompt:", "") + ".md";
    const baseDir = dirname(fileURLToPath(import.meta.url));
    const content = await readFile(join(baseDir, "..", "..", "spec", "ontology", "prompts", fileName), "utf8");
    return content.trim();
  }

  private buildToolsMap(agent: AgentDefinition): Record<string, boolean> {
    const tools: Record<string, boolean> = {};
    for (const toolId of agent.tool_ids) {
      const tool = this.bundle!.tools.find((candidate) => candidate["@id"] === toolId);
      if (!tool) continue;
      tools[tool["@id"].replace("tool:", "")] = true;
    }
    return tools;
  }

  private buildHostPermission(agent: AgentDefinition): Record<string, "allow" | "deny"> {
    const permissions: Record<string, "allow" | "deny"> = { external_directory: "deny" };
    for (const roleId of agent.role_ids) {
      const role = this.bundle!.roles.find((candidate) => candidate["@id"] === roleId);
      if (!role) continue;
      for (const grant of role.permission_grants) {
        const toolName = grant.tool_id.replace("tool:", "");
        permissions[toolName] = grant.effect === "policy-effect:allow" ? "allow" : "deny";
      }
    }
    if (permissions.write === "allow" && permissions.edit === undefined) permissions.edit = "allow";
    if (permissions.edit === "allow" && permissions.write === undefined) permissions.write = "allow";
    return permissions;
  }

  private toHostAgentKey(agentId: OntologyId): string {
    return agentId.replace(/^agent:/, "");
  }
}

let runtimeInstance: OntologyRuntime | null = null;

export function getOntologyRuntime(): OntologyRuntime {
  runtimeInstance ??= new OntologyRuntime();
  return runtimeInstance;
}

export async function initializeOntologyRuntime(): Promise<OntologyRuntime> {
  const runtime = getOntologyRuntime();
  await runtime.initialize();
  return runtime;
}
