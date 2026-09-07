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
 */

import { loadHumanTone } from "../codegen/loader.js";
import type { CompiledAgent } from "../codegen/types.js";
import { OntologyCompiler } from "./compiler.js";
import { OntologyRegistry } from "./registry.js";
import { PolicyEngineImpl } from "../policy/engine.js";
import { JSONLDSerializer } from "../serialization/jsonld.js";
import { Agent, Role, Capability, Tool, OntologyId, OntologicalEntity } from "../types/ontology.js";

/**
 * OntologyRuntime - The new plugin runtime.
 * Initializes the ontology, compiles agents, and provides runtime APIs.
 */
export class OntologyRuntime {
  private compiler: OntologyCompiler;
  private registry: OntologyRegistry;
  private policyEngine: PolicyEngineImpl;
  private serializer: JSONLDSerializer;
  private initialized = false;
  private humanTone = "";

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

    // Load human tone for prompt injection
    this.humanTone = await loadHumanTone();

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
    console.log(`[tori-ontology] Initialized: ${result.agents.length} agents, ${result.roles.length} roles, ${result.capabilities.length} capabilities, ${result.tools.length} tools`);
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
   * Instead of building permission maps, we now:
   * 1. Serialize agents as JSON-LD
   * 2. Provide capability-based tool maps
   * 3. Delegate permission checks to PolicyEngine
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
      const originalSpecId = agent.metadata?.original_spec_id as string || agent['@id'];
      const userCfg = (userAgents[originalSpecId] ?? {}) as Record<string, unknown> & { soul?: boolean };
      const { soul, ...userCfgRest } = userCfg;

      // Build final prompt with human tone
      const agentMode = agent.metadata?.mode as string | undefined;
      const finalPrompt = agentMode === 'all' && soul !== false && this.humanTone
        ? `${agent.metadata?.prompt}\n\nInstructions from: ${configPath}\n${this.humanTone}`
        : (agent.metadata?.prompt as string) || "";

      // Get capabilities for this agent
      const capabilities = this.registry.getRelated(agent['@id'], 'governedBy')
        .filter(e => e['@type'] === 'Capability') as Capability[];

      // Build tool map based on capabilities (not string permissions)
      const toolsMap = this.buildToolsMapFromCapabilities(agent, capabilities, pluginToolNames);

      // Build host permission object (for runtime compatibility)
      const hostPermission = await this.buildHostPermissionFromPolicy(agent, pluginToolNames);

      // Merge user tool overrides
      const userTools = (userCfgRest.tools ?? {}) as Record<string, boolean>;

      input.agent[originalSpecId] = {
        description: agent.description,
        temperature: agent.metadata?.temperature,
        mode: agent.metadata?.mode,
        color: agent.metadata?.color ?? "info",
        ...userCfgRest,
        prompt: finalPrompt,
        tools: { ...toolsMap, ...userTools },
        permission: hostPermission,
      } as never;
    }
  }

  /**
   * Build tool map from agent's capabilities.
   * REPLACES: buildToolsMap() from agents.ts
   */
  private buildToolsMapFromCapabilities(
    agent: Agent,
    capabilities: Capability[],
    pluginToolNames?: Set<string>
  ): Record<string, boolean> {
    const tools: Record<string, boolean> = {};

    // Get tools governed by this agent
    const agentTools = this.registry.getRelated(agent['@id'], 'governedBy')
      .filter(e => e['@type'] === 'Tool') as Tool[];

    for (const tool of agentTools) {
      // Check if the agent has the capability for this tool
      const capId = tool.capability_id;
      const hasCapability = capabilities.some(c => c['@id'] === capId);

      if (hasCapability) {
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
  private async buildHostPermissionFromPolicy(
    agent: Agent,
    pluginToolNames?: Set<string>
  ): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};

    // Get all tools this agent can access
    const agentTools = this.registry.getRelated(agent['@id'], 'governedBy')
      .filter(e => e['@type'] === 'Tool') as Tool[];

    // Build permission map by querying policy engine for each tool
    for (const tool of agentTools) {
      const canAccess = await this.policyEngine.evaluate(
        agent['@id'],
        tool.name,
        "resource:*"
      );
      if (canAccess) {
        result[tool.name] = "allow";
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