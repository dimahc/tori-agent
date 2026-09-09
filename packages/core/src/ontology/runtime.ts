import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ENTITY_TYPES,
  ONTOLOGY_SCHEMA_VERSION,
  getToolId,
  type AgentDefinition,
  type AuthorizationDecision,
  type ExecutionLoopPolicy,
  type OntologyBundle,
  type OntologyId,
  type OutputGovernancePolicy,
  type RuntimeId,
  type RuntimePaths,
} from "@tori-agent/ontology";
import { OntologyCompiler } from "./compiler.js";
import { PolicyEngineImpl } from "../policy/engine.js";
import { JSONLDSerializer } from "../serialization/jsonld.js";
import { getBuiltinOntologyPromptDir, getBuiltinOntologySpecDir } from "./paths.js";

export interface OntologyRuntimeOptions {
  projectRoot?: string;
  runtimePaths?: RuntimePaths;
}

export interface RuntimeAgentConfig {
  description: string;
  temperature: number;
  mode: "all" | "subagent";
  color: string;
  prompt: string;
  tools: Record<string, boolean>;
  permission: Record<string, "allow" | "deny">;
}

export interface DefaultMainSessionAgent {
  agentId: OntologyId;
  hostAgentName: string;
}

export interface RuntimeConfigEnvelope {
  agent: Record<string, RuntimeAgentConfig>;
  default_agent: string;
  session: {
    default_agent: string;
    default_agent_id: OntologyId;
    authoritative: true;
    source: "ontology";
  };
  ontology: {
    authoritative: true;
    default_main_agent: string;
    default_main_agent_id: OntologyId;
    authoritative_agent_keys: string[];
  };
}

export interface SessionAgentBinding {
  agent: string;
  agentId: OntologyId;
  authoritative: true;
  source: "ontology-default-main-agent";
}

type GenericConfigRecord = Record<string, unknown>;

export class OntologyRuntime {
  private readonly compiler: OntologyCompiler;
  private readonly serializer = new JSONLDSerializer();
  private readonly runtimePaths?: RuntimePaths;
  private initialized = false;
  private bundle: OntologyBundle | null = null;
  private policyEngine: PolicyEngineImpl | null = null;
  private readonly sessionAgents = new Map<string, OntologyId>();
  private readonly unknownSessionAgents = new Set<string>();

  constructor(compiler = new OntologyCompiler(), options: OntologyRuntimeOptions = {}) {
    this.compiler = compiler;
    this.runtimePaths = options.runtimePaths;
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
      this.unknownSessionAgents.delete(sessionId);
      return;
    }
    this.sessionAgents.delete(sessionId);
    this.unknownSessionAgents.add(sessionId);
  }

  getBoundAgent(sessionId: string): OntologyId | undefined {
    return this.sessionAgents.get(sessionId);
  }

  unbindSession(sessionId: string): void {
    this.sessionAgents.delete(sessionId);
    this.unknownSessionAgents.delete(sessionId);
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

  async buildRuntimeConfigEnvelope(runtimeId: RuntimeId): Promise<RuntimeConfigEnvelope> {
    const agent = await this.buildRuntimeAgentConfigs(runtimeId);
    const binding = this.getDefaultMainSessionAgent(runtimeId);
    return {
      agent,
      default_agent: binding.hostAgentName,
      session: {
        default_agent: binding.hostAgentName,
        default_agent_id: binding.agentId,
        authoritative: true,
        source: "ontology",
      },
      ontology: {
        authoritative: true,
        default_main_agent: binding.hostAgentName,
        default_main_agent_id: binding.agentId,
        authoritative_agent_keys: Object.keys(agent),
      },
    };
  }

  async integrateHostConfigInPlace(runtimeId: RuntimeId, hostConfig: Record<string, unknown>): Promise<void> {
    const compiled = await this.buildRuntimeConfigEnvelope(runtimeId);
    const base = this.asMutableRecord(hostConfig);
    const hostAgents = this.asRecord(base.agent);
    const mergedAgents: GenericConfigRecord = { ...hostAgents };

    for (const [agentKey, agentConfig] of Object.entries(compiled.agent)) {
      mergedAgents[agentKey] = this.mergeOntologyAgentConfig(hostAgents[agentKey], agentConfig);
    }

    base.agent = mergedAgents;
    base.default_agent = compiled.default_agent;
    base.session = {
      ...this.asRecord(base.session),
      ...compiled.session,
    };
    base.ontology = {
      ...this.asRecord(base.ontology),
      ...compiled.ontology,
    };
  }

  getDefaultMainSessionAgent(runtimeId: RuntimeId): DefaultMainSessionAgent {
    this.assertInitialized();
    const candidates = this.bundle!.agents.filter(
      (agent) => agent.metadata.runtime_ids.includes(runtimeId) && agent.metadata.mode === "all" && agent.metadata.default_main_session === true,
    );
    if (candidates.length !== 1) {
      throw new Error(
        `Ontology must define exactly one default main-session agent for runtime ${runtimeId}; found ${candidates.length}`,
      );
    }
    return {
      agentId: candidates[0]["@id"],
      hostAgentName: this.toHostAgentKey(candidates[0]["@id"]),
    };
  }

  bindSessionToDefaultMainAgent(sessionId: string, runtimeId: RuntimeId): SessionAgentBinding {
    const binding = this.getDefaultMainSessionAgent(runtimeId);
    this.sessionAgents.set(sessionId, binding.agentId);
    this.unknownSessionAgents.delete(sessionId);
    return {
      agent: binding.hostAgentName,
      agentId: binding.agentId,
      authoritative: true,
      source: "ontology-default-main-agent",
    };
  }

  authorizeSession(sessionId: string, toolName: string, pattern?: string | string[], runtimePaths?: Parameters<PolicyEngineImpl["authorize"]>[0]["runtimePaths"]): AuthorizationDecision {
    this.assertInitialized();
    const agentId = this.sessionAgents.get(sessionId);
    if (!agentId) {
      return {
        effect: "deny",
        matchedGrantIds: [],
        reason: `Session ${sessionId} not bound by host to ontology agent`,
      };
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

  isOntologyGovernedToolName(toolName: string): boolean {
    this.assertInitialized();
    const normalized = toolName.replace(/^tool[.:]/, "");
    const toolId = getToolId(normalized);
    return this.bundle!.tools.some((tool) => tool["@id"] === toolId || tool["@id"] === normalized);
  }

  authorizeToolExecution(
    context: { sessionID?: string; agent?: string },
    toolName: string,
    pattern?: string | string[],
    runtimePaths?: Parameters<PolicyEngineImpl["authorize"]>[0]["runtimePaths"],
  ): AuthorizationDecision {
    this.assertInitialized();
    if (!context.sessionID) {
      return { effect: "deny", matchedGrantIds: [], reason: `Missing session context for ${toolName}` };
    }
    if (context.agent) {
      this.bindSession(context.sessionID, context.agent);
    }
    return this.authorizeSession(context.sessionID, toolName, pattern, runtimePaths);
  }

  getExecutionLoopPolicy(agentId: OntologyId, toolId?: OntologyId): ExecutionLoopPolicy {
    this.assertInitialized();
    return this.policyEngine!.getExecutionLoopPolicy(agentId, toolId);
  }

  getOutputGovernancePolicy(agentId: OntologyId): OutputGovernancePolicy {
    this.assertInitialized();
    return this.policyEngine!.getOutputGovernancePolicy(agentId);
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

  private asRecord(value: unknown): GenericConfigRecord {
    return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as GenericConfigRecord) } : {};
  }

  private asMutableRecord(value: unknown): GenericConfigRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Host config must be mutable object");
    }
    return value as GenericConfigRecord;
  }

  private mergeOntologyAgentConfig(hostAgentConfig: unknown, ontologyAgentConfig: RuntimeAgentConfig): GenericConfigRecord {
    const host = this.asRecord(hostAgentConfig);
    return {
      ...host,
      ...ontologyAgentConfig,
      tools: { ...ontologyAgentConfig.tools },
      permission: { ...ontologyAgentConfig.permission },
    };
  }

  private async loadPrompt(promptRef: OntologyId): Promise<string> {
    const fileName = promptRef.replace("prompt:", "") + ".md";
    const localPrompt = this.runtimePaths ? join(this.runtimePaths.ontologyDir, "prompts", fileName) : null;
    const candidates = [localPrompt, join(getBuiltinOntologyPromptDir(), fileName)].filter((value): value is string => Boolean(value));
    for (const candidate of candidates) {
      try {
        const content = await readFile(candidate, "utf8");
        return content.trim();
      } catch {
        // try next candidate
      }
    }
    throw new Error(`Prompt not found for ${promptRef}`);
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

const runtimeInstances = new Map<string, OntologyRuntime>();

function runtimeCacheKey(options: OntologyRuntimeOptions = {}): string {
  if (options.runtimePaths) {
    return JSON.stringify({
      runtimeRoot: options.runtimePaths.runtimeRoot,
      ontologyDir: options.runtimePaths.ontologyDir,
      skillsDir: options.runtimePaths.skillsDir,
      runtimeId: options.runtimePaths.runtimeId,
    });
  }
  return "builtin-runtime";
}

function buildCompiler(options: OntologyRuntimeOptions = {}): OntologyCompiler {
  const sourceDirs = [getBuiltinOntologySpecDir()];
  if (options.runtimePaths) {
    sourceDirs.push(options.runtimePaths.ontologyDir);
  }
  return new OntologyCompiler({ sourceDirs });
}

export function getOntologyRuntime(options: OntologyRuntimeOptions = {}): OntologyRuntime {
  const key = runtimeCacheKey(options);
  let runtime = runtimeInstances.get(key);
  if (!runtime) {
    runtime = new OntologyRuntime(buildCompiler(options), options);
    runtimeInstances.set(key, runtime);
  }
  return runtime;
}

export async function initializeOntologyRuntime(options: OntologyRuntimeOptions = {}): Promise<OntologyRuntime> {
  const runtime = getOntologyRuntime(options);
  await runtime.initialize();
  return runtime;
}
