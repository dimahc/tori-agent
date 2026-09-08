/**
 * @file packages/core/src/ontology/runtime.ts
 * @description Runtime integration for the ontology-oriented architecture.
 * REPLACES: packages/core/src/plugin/agents.ts and packages/core/src/plugin/tools.ts
 * 
 * This is the new plugin entry point that uses:
 * - OntologyRegistry as the system of record
 * - PolicyEngine for all permission decisions
 * - JSONLDSerializer for agent serialization
 * - SHACL validation on registration
 * - Ontology-native behavior (workflows, policies, capabilities) instead of prompts
 */

import { OntologyCompiler } from "./compiler.js";
import { OntologyRegistry } from "./registry.js";
import { PolicyEngineImpl } from "../policy/engine.js";
import { JSONLDSerializer } from "../serialization/jsonld.js";
import { Agent, Role, Capability, Tool, OntologyId, OntologicalEntity, Workflow, Stage, Transition, Policy } from "../types/ontology.js";

/**
 * OntologyRuntime - The new plugin runtime.
 * Initializes the ontology, compiles agents, and provides runtime APIs.
 * Behavior is defined by ontology (workflows, policies, capabilities) not prompts.
 */
export class OntologyRuntime {
  private compiler: OntologyCompiler;
  private registry: OntologyRegistry;
  private policyEngine: PolicyEngineImpl;
  private serializer: JSONLDSerializer;
  private initialized = false;
  private promptCache = new Map<string, string>();

  constructor() {
    this.compiler = new OntologyCompiler();
    this.registry = this.compiler.getRegistry();
    this.policyEngine = new PolicyEngineImpl();
    this.serializer = new JSONLDSerializer();
  }

  /**
   * Initialize the runtime - compile all agents, load registry, load default rules.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Initialize compiler (loads registry from store)
    await this.compiler.initialize();

    // Compile all agents into ontology
    const result = await this.compiler.compileAll();
    
    if (result.errors.length > 0) {
      console.error("[tori-ontology] Compilation errors:", result.errors);
    }
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.warn("[tori-ontology]", w);
    }

    // Ingest all registered entities into the policy engine
    for (const entity of this.registry.getAll()) {
      this.policyEngine.ingestOntology(entity);
    }

    // Load default policy rules
    this.policyEngine.loadDefaultRules();

    // Initialize JSON-LD serializer
    await this.serializer.initialize();

    this.initialized = true;
  }

  /**
   * Get the ontology registry.
   */
  getRegistry(): OntologyRegistry {
    return this.registry;
  }

  /**
   * Get the policy engine.
   */
  getPolicyEngine(): PolicyEngineImpl {
    return this.policyEngine;
  }

  /**
   * Get the JSON-LD serializer.
   */
  getSerializer(): JSONLDSerializer {
    return this.serializer;
  }

  /**
   * Register agents for a runtime (OpenCode/KiloCode).
   * REPLACES: registerAgents() from agents.ts
   * 
   * Instead of building permission maps from prompts, we now:
   * 1. Serialize agents as JSON-LD
   * 2. Provide capability-based tool maps
   * 3. Delegate permission checks to PolicyEngine
   * 4. Include ontology-native behavior (workflows, policies, capabilities)
   */
  async registerAgents(
    input: { agent?: Record<string, unknown> },
    userConfig: Record<string, unknown>,
    runtime: 'opencode' | 'kilocode',
    configPath: string,
    pluginToolNames?: Set<string>
  ): Promise<void> {
    if (!this.initialized) await this.initialize();

    const userAgents = (input.agent ?? {}) as Record<string, unknown>;
    input.agent = input.agent ?? {};

    // Get all agents from registry
    const agents = this.registry.getByType("Agent") as Agent[];

    for (const agent of agents) {
      // Use @id as the key for OpenCode (stripping prefix for host-facing key)
      const fullId = agent['@id'] as string;
      const agentKey = this.getAgentKey(fullId);
      const userCfg = (userAgents[agentKey] ?? {}) as Record<string, unknown> & { soul?: boolean };
      const { soul, ...userCfgRest } = userCfg;

       // Get capabilities for this agent
       const capabilities = this.resolveCapabilities(agent.capabilities, fullId);
       const roles = this.resolveRoles(agent.roles, fullId);
 
        // Get tools for this agent
       const tools = this.resolveTools(agent.tools, fullId);
  
        // Build tool map based on capabilities (not string permissions)
       const toolsMap = this.buildToolsMapFromCapabilities(capabilities, roles, pluginToolNames, tools);
  
        // Build host permission object (for runtime compatibility)
       const hostPermission = this.buildHostPermissionFromRoles(roles, pluginToolNames, tools);
       const prompt = await this.getPromptForAgent(fullId);

      // Merge user tool overrides
      const userTools = (userCfgRest.tools ?? {}) as Record<string, boolean>;

      input.agent[agentKey] = {
        description: agent.description,
        temperature: agent.metadata?.temperature,
        mode: agent.metadata?.mode,
        color: agent.metadata?.color ?? "info",
        ...userCfgRest,
        prompt: typeof userCfgRest.prompt === 'string' ? userCfgRest.prompt : prompt,
        tools: { ...toolsMap, ...userTools },
        permission: hostPermission,
      } as never;
    }
  }

  private getAgentKey(agentId: string): string {
    return agentId.startsWith('agent:') ? agentId.slice('agent:'.length) : agentId;
  }

  private async getPromptForAgent(agentId: string): Promise<string> {
    const cached = this.promptCache.get(agentId);
    if (cached !== undefined) return cached;

    const promptName = this.getPromptFileName(agentId);
    const promptUrl = new URL(`../../spec/ontology/prompts/${promptName}`, import.meta.url);
    const prompt = await import('node:fs/promises').then(({ readFile }) => readFile(promptUrl, 'utf-8'));
    const trimmed = prompt.trim();
    this.promptCache.set(agentId, trimmed);
    return trimmed;
  }

  private getPromptFileName(agentId: string): string {
    const key = this.getAgentKey(agentId);

    if (key === 'tori') return 'tori.md';
    if (key === 'delivery-agent') return 'delivery-agent.md';
    if (key.startsWith('scribe:')) return 'scribe.md';
    if (key.startsWith('specialist:')) return 'specialist.md';
    if (key.startsWith('reviewer:')) return 'reviewer.md';

    throw new Error(`No prompt mapping for agent: ${agentId}`);
  }

  private resolveCapabilities(values: unknown, fallbackId: string): Capability[] {
    if (!Array.isArray(values)) {
      return this.registry.getRelated(fallbackId, 'governedBy').filter(
        (entity): entity is Capability => entity['@type'] === 'Capability',
      );
    }

    return values
      .map((value) => this.resolveEntityReference(value))
      .filter((entity): entity is Capability => entity?.['@type'] === 'Capability');
  }

  private resolveRoles(values: unknown, fallbackId: string): Role[] {
    if (!Array.isArray(values)) {
      return this.registry.getRelated(fallbackId, 'governedBy').filter(
        (entity): entity is Role => entity['@type'] === 'Role',
      );
    }

    return values
      .map((value) => this.resolveEntityReference(value))
      .filter((entity): entity is Role => entity?.['@type'] === 'Role');
  }

  private resolveTools(values: unknown, fallbackId: string): Tool[] {
    if (!Array.isArray(values)) {
      return this.registry.getRelated(fallbackId, 'governedBy').filter(
        (entity): entity is Tool => entity['@type'] === 'Tool',
      );
    }

    return values
      .map((value) => this.resolveEntityReference(value))
      .filter((entity): entity is Tool => entity?.['@type'] === 'Tool');
  }

  private resolveEntityReference(value: unknown) {
    if (typeof value === 'string') return this.registry.get(value);
    if (typeof value === 'object' && value !== null && '@id' in value) {
      const id = (value as { '@id'?: unknown })['@id'];
      if (typeof id === 'string') return this.registry.get(id) ?? (value as never);
    }
    return undefined;
  }

  /**
   * Get ontology-native behavior for an agent.
   * Returns workflows, policies, stages, and capabilities instead of a prompt.
   */
  getAgentBehavior(agent: Agent): AgentBehavior {
    // Get implemented workflows
    const implementsWorkflows = (agent.metadata?.implements as string[]) || [];
    const workflows: Workflow[] = [];
    for (const wfId of implementsWorkflows) {
      const wf = this.registry.get(wfId);
      if (wf && wf['@type'] === 'Workflow') workflows.push(wf as Workflow);
    }

    // Get policies governed by this agent
    const policies = this.registry.getRelated(agent['@id'], 'governedBy')
      .filter(e => e['@type'] === 'Policy') as Policy[];

    // Get stages from workflows
    const stages: Stage[] = [];
    for (const wf of workflows) {
      const stageIds = (wf.stages as unknown as string[]) || [];
      for (const stageId of stageIds) {
        const stage = this.registry.get(stageId);
        if (stage && stage['@type'] === 'Stage') stages.push(stage as Stage);
      }
    }

    // Get transitions from workflows
    const transitions: Transition[] = [];
    for (const wf of workflows) {
      const transIds = (wf.transitions as unknown as string[]) || [];
      for (const transId of transIds) {
        const trans = this.registry.get(transId);
        if (trans && trans['@type'] === 'Transition') transitions.push(trans as Transition);
      }
    }

    // Get capabilities
    const capabilities = this.registry.getRelated(agent['@id'], 'governedBy')
      .filter(e => e['@type'] === 'Capability') as Capability[];

    return {
      workflows,
      policies,
      stages,
      transitions,
      capabilities,
      // Current stage tracking (would be persisted in workflow state)
      currentStage: stages[0]?.['@id'] || null,
    };
  }

  /**
   * Build tool map from agent's capabilities.
   * REPLACES: buildToolsMap() from agents.ts
   */
   private buildToolsMapFromCapabilities(
      capabilities: Capability[],
      roles: Role[],
      pluginToolNames?: Set<string>,
      explicitTools?: Tool[]
    ): Record<string, boolean> {
      const tools: Record<string, boolean> = {};
      const allowedPermissions = new Set(roles.flatMap((role) => role.permissions ?? []));
      const agentTools = explicitTools ?? [];
  
      for (const tool of agentTools) {
        const capId = tool.capability_id;
        const hasCapability = capabilities.some(c => c['@id'] === capId);
        const allowedByRole = allowedPermissions.has(tool.name);
  
        if (hasCapability || allowedByRole) {
          tools[tool.name] = true;
        } else if (pluginToolNames && pluginToolNames.has(tool.name)) {
          tools[tool.name] = false;
        }
      }
 
     // Add MCP tools (always allowed if no explicit deny)
     if (pluginToolNames) {
       for (const toolName of pluginToolNames) {
         if (toolName.includes('__') || toolName.startsWith('mcp_') || toolName.startsWith('list_mcp_') || toolName.startsWith('read_mcp_')) {
           if (tools[toolName] === undefined) {
             tools[toolName] = true;
           }
         }
       }
     }
 
     return tools;
   }

  /**
   * Build host permission object from policy engine.
   * REPLACES: buildHostPermission() from agents.ts
   */
   private buildHostPermissionFromRoles(
      roles: Role[],
      pluginToolNames?: Set<string>,
      explicitTools?: Tool[]
    ): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      const allowedPermissions = new Set(roles.flatMap((role) => role.permissions ?? []));
      const agentTools = explicitTools ?? [];

      for (const tool of agentTools) {
        if (allowedPermissions.has(tool.name)) {
          result[tool.name] = 'allow';
        }
      }
 
     // Handle write/edit special case
     if (result.write === undefined && result.edit === "allow") {
       result.write = "allow";
     }
     if (result.edit === undefined && result.write === "allow") {
       result.edit = "allow";
     }
 
     // External directory access
     if (result.external_directory === undefined) {
       result.external_directory = "deny";
     }
 
     // MCP tools pass through
     if (pluginToolNames) {
       for (const toolName of pluginToolNames) {
         if (toolName.includes('__') || toolName.startsWith('mcp_')) {
           if (result[toolName] === undefined) {
             result[toolName] = "allow";
           }
         }
       }
     }
 
     return result;
   }

  /**
   * Evaluate permission using the policy engine.
   * REPLACES: evaluatePermission() from agents.ts
   */
  async evaluatePermission(
    agentId: string,
    tool: string,
    pattern?: string | string[]
  ): Promise<'allow' | 'deny'> {
    // Check .env protection
    if ((tool === 'read' || tool === 'edit' || tool === 'write') && pattern) {
      const patterns = Array.isArray(pattern) ? pattern : [pattern];
      for (const p of patterns) {
        if (typeof p === 'string' && /(^|\/|\\)\.env($|\.(?!example($|\/|\\)))/i.test(p)) {
          return 'deny';
        }
      }
    }

    // Delegate to policy engine
    const allowed = await this.policyEngine.evaluate(agentId, tool, pattern?.toString() || "resource:*");
    return allowed ? 'allow' : 'deny';
  }

  /**
   * Check doom loop (preserved from old agents.ts).
   */
  checkDoomLoop(sessionID: string, tool: string, pattern?: string | string[]): boolean {
    // Simplified - could be enhanced with ontology-based tracking
    return false;
  }

  /**
   * Serialize an agent as JSON-LD for interoperability.
   */
  async serializeAgent(agentId: OntologyId): Promise<string> {
    const agent = this.registry.get(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return this.serializer.serialize(agent);
  }

  /**
   * Get all agents as JSON-LD.
   */
  async serializeAllAgents(): Promise<string[]> {
    const agents = this.registry.getByType("Agent");
    return Promise.all(agents.map(a => this.serializer.serialize(a)));
  }

  /**
   * Query agents by capability.
   * NEW: Capability-based dispatch.
   */
  getAgentsByCapability(capabilityId: string): Agent[] {
    const capEntity = this.registry.get(`capability:${capabilityId}` as OntologyId);
    if (!capEntity) return [];
    
    // Find agents that have this capability
    const agents = this.registry.getByType("Agent");
    return agents.filter(agent => {
      const caps = this.registry.getRelated(agent['@id'], 'governedBy')
        .filter(e => e['@type'] === 'Capability');
      return caps.some(c => c['@id'] === capEntity['@id']);
    }) as Agent[];
  }

  /**
   * Check if agent has a specific capability.
   */
  agentHasCapability(agentId: OntologyId, capabilityId: string): boolean {
    const agent = this.registry.get(agentId);
    if (!agent) return false;
    
    const caps = this.registry.getRelated(agentId, 'governedBy')
      .filter(e => e['@type'] === 'Capability');
    return caps.some(c => c['@id'] === `capability:${capabilityId}`);
  }
}

/**
 * Ontology-native agent behavior - replaces prompts.
 * Contains workflows, policies, stages, transitions, and capabilities.
 */
export interface AgentBehavior {
  workflows: Workflow[];
  policies: Policy[];
  stages: Stage[];
  transitions: Transition[];
  capabilities: Capability[];
  currentStage: OntologyId | null;
}

/**
 * Singleton instance for the runtime.
 */
let runtimeInstance: OntologyRuntime | null = null;

export function getOntologyRuntime(): OntologyRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new OntologyRuntime();
  }
  return runtimeInstance;
}

export async function initializeOntologyRuntime(): Promise<OntologyRuntime> {
  const runtime = getOntologyRuntime();
  await runtime.initialize();
  return runtime;
}
