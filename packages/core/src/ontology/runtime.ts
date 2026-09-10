import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ENTITY_TYPES,
  ONTOLOGY_SCHEMA_VERSION,
  getToolId,
  isKnownArtifactStatusId,
  isKnownArtifactTypeId,
  isKnownCheckPolicyId,
  isKnownCheckStatusId,
  isKnownTaskStatusId,
  isKnownWorkflowStageId,
  isKnownWorkflowStatusId,
  type AgentDefinition,
  type AuthorizationDecision,
  type ExecutionLoopPolicy,
  type OntologyBundle,
  type OntologyId,
  type OutputGovernancePolicy,
  type RoleDefinition,
  type RuntimeId,
  type RuntimePaths,
  type ToolDefinition,
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
  permission: Record<string, "allow" | "deny" | "ask">;
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

interface RuntimeDerivedState {
  readonly agentsById: Map<OntologyId, AgentDefinition>;
  readonly rolesById: Map<OntologyId, RoleDefinition>;
  readonly toolsById: Map<OntologyId, ToolDefinition>;
  readonly agentIdByHostName: Map<string, OntologyId>;
  readonly governedToolNames: Set<string>;
  readonly toolsMapByAgentId: Map<OntologyId, Record<string, boolean>>;
  readonly permissionMapByAgentId: Map<OntologyId, Record<string, "allow" | "deny" | "ask">>;
  readonly agentsByCapability: Map<OntologyId, AgentDefinition[]>;
}

export class OntologyRuntime {
  private readonly compiler: OntologyCompiler;
  private readonly serializer = new JSONLDSerializer();
  private readonly runtimePaths?: RuntimePaths;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;
  private bundle: OntologyBundle | null = null;
  private policyEngine: PolicyEngineImpl | null = null;
  private derived: RuntimeDerivedState | null = null;
  private readonly sessionAgents = new Map<string, OntologyId>();
  private readonly unknownSessionAgents = new Set<string>();
  private readonly promptCache = new Map<OntologyId, Promise<string>>();
  private readonly runtimeAgentConfigCache = new Map<RuntimeId, Promise<Record<string, RuntimeAgentConfig>>>();
  private readonly defaultMainSessionAgentCache = new Map<RuntimeId, DefaultMainSessionAgent>();

  constructor(compiler = new OntologyCompiler(), options: OntologyRuntimeOptions = {}) {
    this.compiler = compiler;
    this.runtimePaths = options.runtimePaths;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }
    this.initializePromise = this.initializeInternal();
    try {
      await this.initializePromise;
    } catch (error) {
      this.initializePromise = null;
      throw error;
    }
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
    let pending = this.runtimeAgentConfigCache.get(runtimeId);
    if (!pending) {
      pending = this.buildRuntimeAgentConfigsCanonical(runtimeId);
      this.runtimeAgentConfigCache.set(runtimeId, pending);
    }
    return this.cloneRuntimeAgentConfigs(await pending);
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
    let cached = this.defaultMainSessionAgentCache.get(runtimeId);
    if (!cached) {
      const candidates = this.bundle!.agents.filter(
        (agent) => agent.metadata.runtime_ids.includes(runtimeId) && agent.metadata.mode === "all" && agent.metadata.default_main_session === true,
      );
      if (candidates.length !== 1) {
        throw new Error(
          `Ontology must define exactly one default main-session agent for runtime ${runtimeId}; found ${candidates.length}`,
        );
      }
      cached = {
        agentId: candidates[0]["@id"],
        hostAgentName: this.toHostAgentKey(candidates[0]["@id"]),
      };
      this.defaultMainSessionAgentCache.set(runtimeId, cached);
    }
    return { ...cached };
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
    return this.derived!.governedToolNames.has(normalized) || this.derived!.governedToolNames.has(toolId);
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

  hasOntologyId(entityId: OntologyId): boolean {
    this.assertInitialized();
    return this.bundle!.byId.has(entityId);
  }

  requireKnownOntologyId(entityId: OntologyId, context: string): OntologyId {
    this.assertInitialized();
    if (!this.hasOntologyId(entityId)) {
      throw new Error(`Unknown ontology ID for ${context}: ${entityId}`);
    }
    return entityId;
  }

  requireKnownWorkflowDefinitionId(entityId: OntologyId, context = "workflow definition"): OntologyId {
    this.assertInitialized();
    const entity = this.bundle!.byId.get(entityId);
    if (!entity || entity["@type"] !== ENTITY_TYPES.WorkflowDefinition) {
      throw new Error(`Unknown ontology ID for ${context}: ${entityId}`);
    }
    return entityId;
  }

  requireKnownWorkflowStageId(entityId: OntologyId, context = "workflow stage"): OntologyId {
    this.assertInitialized();
    if (!isKnownWorkflowStageId(entityId)) {
      throw new Error(`Unknown ontology ID for ${context}: ${entityId}`);
    }
    const entity = this.bundle!.byId.get(entityId);
    if (!entity || entity["@type"] !== ENTITY_TYPES.WorkflowStage) {
      throw new Error(`Unknown ontology ID for ${context}: ${entityId}`);
    }
    return entityId;
  }

  requireKnownWorkflowStatusId(entityId: OntologyId, context = "workflow status"): OntologyId {
    this.assertInitialized();
    if (!isKnownWorkflowStatusId(entityId)) {
      throw new Error(`Unknown ontology ID for ${context}: ${entityId}`);
    }
    return entityId;
  }

  requireKnownTaskStatusId(entityId: OntologyId, context = "task status"): OntologyId {
    this.assertInitialized();
    if (!isKnownTaskStatusId(entityId)) {
      throw new Error(`Unknown ontology ID for ${context}: ${entityId}`);
    }
    return entityId;
  }

  requireKnownCheckStatusId(entityId: OntologyId, context = "check status"): OntologyId {
    this.assertInitialized();
    if (!isKnownCheckStatusId(entityId)) {
      throw new Error(`Unknown ontology ID for ${context}: ${entityId}`);
    }
    return entityId;
  }

  requireKnownCheckPolicyId(entityId: OntologyId, context = "check policy"): OntologyId {
    this.assertInitialized();
    if (!isKnownCheckPolicyId(entityId)) {
      throw new Error(`Unknown ontology ID for ${context}: ${entityId}`);
    }
    return entityId;
  }

  requireKnownArtifactTypeId(entityId: OntologyId, context = "artifact type"): OntologyId {
    this.assertInitialized();
    if (!isKnownArtifactTypeId(entityId)) {
      throw new Error(`Unknown ontology ID for ${context}: ${entityId}`);
    }
    return entityId;
  }

  requireKnownArtifactStatusId(entityId: OntologyId, context = "artifact status"): OntologyId {
    this.assertInitialized();
    if (!isKnownArtifactStatusId(entityId)) {
      throw new Error(`Unknown ontology ID for ${context}: ${entityId}`);
    }
    return entityId;
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
    return [...(this.derived!.agentsByCapability.get(capabilityId) ?? [])];
  }

  agentHasCapability(agentId: OntologyId, capabilityId: OntologyId): boolean {
    this.assertInitialized();
    const agent = this.derived!.agentsById.get(agentId);
    return Boolean(agent?.capability_ids.includes(capabilityId));
  }

  private async initializeInternal(): Promise<void> {
    await this.compiler.initialize();
    const result = await this.compiler.compileAll();
    if (result.errors.length > 0) {
      throw new Error(`Ontology compilation failed: ${result.errors.map((entry) => `${entry.specId}: ${entry.error}`).join(" | ")}`);
    }
    this.bundle = this.compiler.getRegistry().getBundle();
    this.derived = this.buildDerivedState(this.bundle);
    this.policyEngine = new PolicyEngineImpl(this.bundle);
    await this.serializer.initialize();
    this.initialized = true;
  }

  private assertInitialized(): void {
    if (!this.initialized || !this.bundle || !this.policyEngine) {
      throw new Error("OntologyRuntime not initialized");
    }
  }

  private resolveAgentId(hostAgentName: string): OntologyId | undefined {
    return this.derived!.agentIdByHostName.get(hostAgentName);
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
    let pending = this.promptCache.get(promptRef);
    if (!pending) {
      pending = this.loadPromptUncached(promptRef);
      this.promptCache.set(promptRef, pending);
    }
    return pending;
  }

  private buildToolsMap(agent: AgentDefinition): Record<string, boolean> {
    return this.cloneBooleanMap(this.derived!.toolsMapByAgentId.get(agent["@id"]) ?? {});
  }

  private buildHostPermission(agent: AgentDefinition): Record<string, "allow" | "deny" | "ask"> {
    return this.clonePermissionMap(this.derived!.permissionMapByAgentId.get(agent["@id"]) ?? { external_directory: "deny" });
  }

  private toHostAgentKey(agentId: OntologyId): string {
    return agentId.replace(/^agent:/, "");
  }

  private async buildRuntimeAgentConfigsCanonical(runtimeId: RuntimeId): Promise<Record<string, RuntimeAgentConfig>> {
    const configs: Record<string, RuntimeAgentConfig> = {};
    const agents = this.bundle!.agents.filter((agent) => agent.metadata.runtime_ids.includes(runtimeId));
    const prompts = await Promise.all(agents.map((agent) => this.loadPrompt(agent.prompt_ref)));
    for (const [index, agent] of agents.entries()) {
      configs[this.toHostAgentKey(agent["@id"])] = {
        description: agent.description,
        temperature: agent.metadata.temperature,
        mode: agent.metadata.mode,
        color: agent.metadata.color,
        prompt: prompts[index],
        tools: this.buildToolsMap(agent),
        permission: this.buildHostPermission(agent),
      };
    }
    return configs;
  }

  private buildDerivedState(bundle: OntologyBundle): RuntimeDerivedState {
    const agentsById = new Map<OntologyId, AgentDefinition>(bundle.agents.map((agent) => [agent["@id"], agent]));
    const rolesById = new Map<OntologyId, RoleDefinition>(bundle.roles.map((role) => [role["@id"], role]));
    const toolsById = new Map<OntologyId, ToolDefinition>(bundle.tools.map((tool) => [tool["@id"], tool]));
    const agentIdByHostName = new Map<OntologyId, OntologyId>();
    const governedToolNames = new Set<string>();
    const toolsMapByAgentId = new Map<OntologyId, Record<string, boolean>>();
    const permissionMapByAgentId = new Map<OntologyId, Record<string, "allow" | "deny" | "ask">>();
    const agentsByCapability = new Map<OntologyId, AgentDefinition[]>();

    for (const tool of bundle.tools) {
      governedToolNames.add(tool["@id"]);
      governedToolNames.add(tool["@id"].replace(/^tool:/, ""));
    }

    for (const agent of bundle.agents) {
      agentIdByHostName.set(agent["@id"], agent["@id"]);
      agentIdByHostName.set(this.toHostAgentKey(agent["@id"]), agent["@id"]);

      const tools: Record<string, boolean> = {};
      for (const toolId of agent.tool_ids) {
        const tool = toolsById.get(toolId);
        if (!tool) continue;
        tools[tool["@id"].replace("tool:", "")] = true;
      }
      toolsMapByAgentId.set(agent["@id"], tools);

      const permissions: Record<string, "allow" | "deny" | "ask"> = { external_directory: "deny" };
      const agentRoles = agent.role_ids
        .map((roleId) => rolesById.get(roleId))
        .filter((role): role is RoleDefinition => Boolean(role));
      for (const roleId of agent.role_ids) {
        const role = rolesById.get(roleId);
        if (!role) continue;
        for (const grant of role.permission_grants) {
          const toolName = grant.tool_id.replace("tool:", "");
          permissions[toolName] =
            grant.effect === "policy-effect:allow" ? "allow" : grant.effect === "policy-effect:ask" ? "ask" : "deny";
        }
      }
      for (const policy of bundle.policies) {
        if (policy.policy_kind_id !== "policy-kind:authorization" || policy.effect !== "policy-effect:ask") continue;
        if (policy.subject_agent_ids && !policy.subject_agent_ids.includes(agent["@id"])) continue;
        if (policy.subject_role_ids && !agentRoles.some((role) => policy.subject_role_ids!.includes(role["@id"]))) continue;
        if (policy.capability_ids && !policy.capability_ids.some((capabilityId) => agent.capability_ids.includes(capabilityId))) continue;
        for (const toolId of policy.tool_ids ?? []) {
          const toolName = toolId.replace("tool:", "");
          if (permissions[toolName] === "deny") continue;
          permissions[toolName] = "ask";
        }
      }
      permissionMapByAgentId.set(agent["@id"], permissions);

      for (const capabilityId of agent.capability_ids) {
        const agents = agentsByCapability.get(capabilityId);
        if (agents) {
          agents.push(agent);
        } else {
          agentsByCapability.set(capabilityId, [agent]);
        }
      }
    }

    return {
      agentsById,
      rolesById,
      toolsById,
      agentIdByHostName,
      governedToolNames,
      toolsMapByAgentId,
      permissionMapByAgentId,
      agentsByCapability,
    };
  }

  private async loadPromptUncached(promptRef: OntologyId): Promise<string> {
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

  private cloneRuntimeAgentConfigs(configs: Record<string, RuntimeAgentConfig>): Record<string, RuntimeAgentConfig> {
    return Object.fromEntries(Object.entries(configs).map(([key, config]) => [key, this.cloneRuntimeAgentConfig(config)]));
  }

  private cloneRuntimeAgentConfig(config: RuntimeAgentConfig): RuntimeAgentConfig {
    return {
      ...config,
      tools: this.cloneBooleanMap(config.tools),
      permission: this.clonePermissionMap(config.permission),
    };
  }

  private cloneBooleanMap(source: Record<string, boolean>): Record<string, boolean> {
    return { ...source };
  }

  private clonePermissionMap(source: Record<string, "allow" | "deny" | "ask">): Record<string, "allow" | "deny" | "ask"> {
    return { ...source };
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
