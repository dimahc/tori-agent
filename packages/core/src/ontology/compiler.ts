/**
 * @file packages/core/src/ontology/compiler.ts
 * @description Compiles YAML agent specifications into ontological entities.
 * This REPLACES the old compileAgent/buildPermissions logic.
 * 
 * The compiler produces:
 * - Agent entities (with roles, capabilities, tools)
 * - Role entities (with permissions, capabilities)
 * - Capability entities (with scope)
 * - Tool entities (with capability_id)
 * - Skill entities (with required_capabilities)
 * All registered in the OntologyRegistry.
 */

import yaml from "js-yaml";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifySpecSignature, computeContentHash } from "../codegen/signing.js";
import { validateSkillPermissions } from "../codegen/skill-validation.js";
import type { AgentSpec, AgentPermissions } from "../codegen/types.js";
import {
  OntologyRegistry,
  DEFAULT_REGISTRY_CONFIG,
} from "./registry.js";
import {
  Agent,
  Role,
  Capability,
  Skill,
  Tool,
  OntologyId,
  OntologicalEntity,
} from "../types/ontology.js";
import { ShaclValidator } from "../validation/shacl.js";
import { MigrationEngine } from "./migration.js";
import { FileSystemOntologyStore } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveSpecDir(): string {
  return join(__dirname, "..", "..", "spec");
}

/**
 * OntologyCompiler - Single source of truth for agent compilation.
 * Produces ontological entities that are validated and registered.
 */
export class OntologyCompiler {
  private registry: OntologyRegistry;
  private validator: ShaclValidator;
  private migrationEngine: MigrationEngine;
  private store: FileSystemOntologyStore;

  constructor(registry?: OntologyRegistry) {
    this.registry = registry || new OntologyRegistry(DEFAULT_REGISTRY_CONFIG);
    this.validator = this.registry.getValidator();
    this.migrationEngine = this.registry.getMigrationEngine();
    this.store = new FileSystemOntologyStore();
    this.registry.setStore(this.store);
  }

  /**
   * Get the registry instance.
   */
  getRegistry(): OntologyRegistry {
    return this.registry;
  }

  /**
   * Initialize the compiler (loads registry from store).
   */
  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.registry.initialize();
  }

  /**
   * Load and compile ALL agent specs into the ontology.
   * This is the main entry point - replaces loadAndCompileAllAgents().
   */
  async compileAll(): Promise<CompilationResult> {
    const specs = await this.loadAgentSpecs();
    const result: CompilationResult = {
      agents: [],
      roles: [],
      capabilities: [],
      skills: [],
      tools: [],
      errors: [],
      warnings: [],
    };

    for (const spec of specs) {
      try {
        const compiled = await this.compileSpec(spec);
        result.agents.push(...compiled.agents);
        result.roles.push(...compiled.roles);
        result.capabilities.push(...compiled.capabilities);
        result.skills.push(...compiled.skills);
        result.tools.push(...compiled.tools);
        result.warnings.push(...compiled.warnings);
      } catch (error) {
        result.errors.push({
          specId: spec.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Persist all registered entities
    await this.store.save(this.registry.getAll().reduce((map, e) => map.set(e['@id'], e), new Map()));

    return result;
  }

  /**
   * Compile a single AgentSpec into ontological entities.
   */
  async compileSpec(spec: AgentSpec): Promise<CompiledSpecResult> {
    const result: CompiledSpecResult = {
      agents: [],
      roles: [],
      capabilities: [],
      skills: [],
      tools: [],
      warnings: [],
    };

    // 1. Load base prompt and references
    const basePrompt = await this.loadPrompt(spec.prompt);
    if (!basePrompt) {
      throw new Error(`Prompt not found for agent "${spec.id}": ${spec.prompt}`);
    }
    const references = await this.loadReferences(spec.references);
    const referencesText = references ? `${references}\n\n` : "";

    // 2. Build permissions from spec
    const basePermissions = this.buildOntologicalPermissions(spec.permissions, spec);

    // 3. Handle personas/modes
    const entries = spec.personas ?? spec.modes;

    if (!entries) {
      // Single agent compilation
      const agent = await this.compileSingleAgent(spec, basePermissions, referencesText, basePrompt);
      result.agents.push(agent);
      return result;
    }

    // 4. Compile each persona as a separate Agent entity
    for (const [key, entry] of Object.entries(entries)) {
      const instructions = await this.loadPrompt(entry.instructions);
      if (!instructions) {
        result.warnings.push(`Instructions not found for "${spec.id}:${key}": ${entry.instructions}`);
        continue;
      }

      const mergedPerms = entry.permissions
        ? this.mergePermissions(spec.permissions, entry.permissions)
        : spec.permissions;
      const ontologicalPerms = this.buildOntologicalPermissions(mergedPerms, { ...spec, id: `${spec.id}:${key}`, description: entry.description });

      const agent = await this.compileSingleAgent(
        { ...spec, id: `${spec.id}:${key}`, description: entry.description },
        ontologicalPerms,
        referencesText,
        `${referencesText}${basePrompt}\n\n${instructions}`
      );
      result.agents.push(agent);
    }

    return result;
  }

  /**
   * Compile a single agent with its permissions into ontological entities.
   */
  private async compileSingleAgent(
    spec: AgentSpec,
    permissions: OntologicalPermissions,
    referencesText: string,
    fullPrompt: string
  ): Promise<Agent> {
    const agentId = `agent:${spec.id}` as OntologyId;

    // Create Capability entities
    const capabilities: Capability[] = [];
    for (const cap of permissions.capabilities) {
      const capEntity: Capability = {
        "@id": `capability:${cap.id}` as OntologyId,
        "@type": "Capability",
        name: cap.name,
        description: cap.description,
        scope: cap.scope,
        governedBy: agentId,
      };
      capabilities.push(capEntity);
      await this.registry.register(capEntity);
    }

    // Create Tool entities
    const tools: Tool[] = [];
    for (const tool of permissions.tools) {
      const toolEntity: Tool = {
        "@id": `tool:${tool.id}` as OntologyId,
        "@type": "Tool",
        name: tool.name,
        description: tool.description,
        capability_id: `capability:${tool.capability_id}` as OntologyId,
        governedBy: agentId,
      };
      tools.push(toolEntity);
      await this.registry.register(toolEntity);
    }

    // Create Role entities
    const roles: Role[] = [];
    for (const role of permissions.roles) {
      const roleId = `role:${role.id}` as OntologyId;
      const roleEntity: Role = {
        "@id": roleId,
        "@type": "Role",
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        capabilities: capabilities.filter(c => role.capabilities.includes(c['@id'].replace('capability:', ''))),
        governedBy: agentId,
      };
      roles.push(roleEntity);
      await this.registry.register(roleEntity);
    }

    // Create Skill entities
    const skills: Skill[] = [];
    for (const skill of permissions.skills) {
      const skillEntity: Skill = {
        "@id": `skill:${skill.id}` as OntologyId,
        "@type": "Skill",
        name: skill.name,
        description: skill.description,
        required_capabilities: capabilities.filter(c => skill.required_capabilities.includes(c['@id'].replace('capability:', ''))),
        governedBy: agentId,
      };
      skills.push(skillEntity);
      await this.registry.register(skillEntity);
    }

    // Create the Agent entity
    const agent: Agent = {
      "@id": agentId,
      "@type": "Agent",
      name: spec.name,
      description: spec.description,
      roles,
      capabilities,
      tools,
      metadata: {
        prompt: fullPrompt,
        temperature: spec.temperature,
        mode: spec.mode,
        color: spec.color ?? "info",
        human_tone: spec.human_tone,
        risk_tier: spec.risk_tier,
        platforms: spec.platforms,
        author: spec.author,
        scan_status: spec.scan_status,
        changelog: spec.changelog,
        original_spec_id: spec.id,
      },
    };

    // Register the agent (triggers validation + migration)
    const regResult = await this.registry.register(agent);
    if (!regResult.success) {
      throw new Error(`Failed to register agent ${agentId}: ${regResult.error}`);
    }

    return agent;
  }

  /**
   * Build ontological permissions from legacy AgentPermissions.
   * This is the key translation layer from old -> new.
   */
  private buildOntologicalPermissions(p: AgentPermissions, spec: AgentSpec): OntologicalPermissions {
    const result: OntologicalPermissions = {
      capabilities: [],
      tools: [],
      roles: [],
      skills: [],
    };

    // Default capabilities from allowed tools
    const toolCapabilityMap: Record<string, { id: string; name: string; description: string; scope: string }> = {
      read: { id: "read", name: "Read Files", description: "Read file contents", scope: "filesystem" },
      write: { id: "write", name: "Write Files", description: "Create and modify files", scope: "filesystem" },
      edit: { id: "edit", name: "Edit Files", description: "Modify existing files", scope: "filesystem" },
      bash: { id: "bash", name: "Execute Commands", description: "Run shell commands", scope: "system" },
      glob: { id: "glob", name: "File Pattern Matching", description: "Find files by pattern", scope: "filesystem" },
      grep: { id: "grep", name: "Content Search", description: "Search file contents", scope: "filesystem" },
      task: { id: "task", name: "Spawn Subagents", description: "Launch child agents", scope: "orchestration" },
      webfetch: { id: "webfetch", name: "Web Fetch", description: "Fetch web content", scope: "network" },
      websearch: { id: "websearch", name: "Web Search", description: "Search the web", scope: "network" },
    };

    // Build capabilities from allow list
    if (p.allow) {
      for (const toolName of p.allow) {
        const capInfo = toolCapabilityMap[toolName] || { 
          id: toolName, 
          name: toolName, 
          description: `Tool: ${toolName}`, 
          scope: "tool" 
        };
        if (!result.capabilities.find(c => c.id === capInfo.id)) {
          result.capabilities.push(capInfo);
        }
        if (!result.tools.find(t => t.id === toolName)) {
          result.tools.push({
            id: toolName,
            name: toolName,
            description: capInfo.description,
            capability_id: capInfo.id,
          });
        }
      }
    }

    // Build capabilities from allow_paths
    if (p.allow_paths) {
      for (const [tool, paths] of Object.entries(p.allow_paths)) {
        const capId = `${tool}_paths`;
        if (!result.capabilities.find(c => c.id === capId)) {
          result.capabilities.push({
            id: capId,
            name: `${tool} Path Access`,
            description: `Scoped ${tool} access to specific paths`,
            scope: "filesystem",
          });
        }
        if (!result.tools.find(t => t.id === tool)) {
          result.tools.push({
            id: tool,
            name: tool,
            description: `Scoped ${tool} access`,
            capability_id: capId,
          });
        }
      }
    }

    // Build capabilities from allow_commands
    if (p.allow_commands) {
      for (const [tool, commands] of Object.entries(p.allow_commands)) {
        const capId = `${tool}_commands`;
        if (!result.capabilities.find(c => c.id === capId)) {
          result.capabilities.push({
            id: capId,
            name: `${tool} Command Access`,
            description: `Scoped ${tool} access to specific commands`,
            scope: "system",
          });
        }
        if (!result.tools.find(t => t.id === tool)) {
          result.tools.push({
            id: tool,
            name: tool,
            description: `Scoped ${tool} command access`,
            capability_id: capId,
          });
        }
      }
    }

    // Network capabilities
    if (p.network?.allow) {
      const capId = "network_access";
      if (!result.capabilities.find(c => c.id === capId)) {
        result.capabilities.push({
          id: capId,
          name: "Network Access",
          description: "Outbound network requests to allowed domains",
          scope: "network",
        });
      }
      if (!result.tools.find(t => t.id === "network")) {
        result.tools.push({
          id: "network",
          name: "network",
          description: "Network access tool",
          capability_id: capId,
        });
      }
    }

    // Default role: the agent's base role
    const baseRoleId = specIdToRoleId(spec.id);
    result.roles.push({
      id: baseRoleId,
      name: spec.name,
      description: `Base role for ${spec.name}`,
      permissions: p.allow || [],
      capabilities: result.capabilities.map(c => c.id),
    });

    // Default skill: the agent's primary skill
    result.skills.push({
      id: `${spec.id}_primary`,
      name: `${spec.name} Primary Skill`,
      description: `Primary skill for ${spec.name}`,
      required_capabilities: result.capabilities.map(c => c.id),
    });

    return result;
  }

  /**
   * Merge base and override permissions (legacy compatibility).
   */
  private mergePermissions(base: AgentPermissions, override: AgentPermissions): AgentPermissions {
    return {
      allow: [...new Set([...(base.allow || []), ...(override.allow || [])])],
      deny: [...new Set([...(base.deny || []), ...(override.deny || [])])],
      allow_paths: { ...base.allow_paths, ...override.allow_paths },
      allow_commands: { ...base.allow_commands, ...override.allow_commands },
      deny_write: [...new Set([...(base.deny_write || []), ...(override.deny_write || [])])],
      network: {
        allow: [...new Set([...(base.network?.allow || []), ...(override.network?.allow || [])])],
        deny: [...new Set([...(base.network?.deny || []), ...(override.network?.deny || [])])],
      },
    };
  }

  /**
   * Load agent specs from spec/agents/ directory.
   */
  async loadAgentSpecs(): Promise<AgentSpec[]> {
    const specDir = resolveSpecDir();
    const agentsDir = join(specDir, "agents");

    let files: string[];
    try {
      files = await readdir(agentsDir);
    } catch {
      console.warn("[tori-core] spec/agents/ not found — using fallback agent definitions");
      return [];
    }

    const specs: AgentSpec[] = [];

    for (const file of files) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;

      const filePath = join(agentsDir, file);
      try {
        const content = await readFile(filePath, "utf-8");
        const spec = yaml.load(content) as AgentSpec;
        if (spec && spec.id) {
          if (spec.content_hash) {
            const actualHash = computeContentHash(content);
            if (actualHash !== spec.content_hash) {
              console.warn(`[tori-core] Agent spec ${file} content_hash mismatch`);
              continue;
            }
          }

          if (spec.signature) {
            const publicKeyHex = process.env.TORI_AGENT_PUBLIC_KEY_HEX;
            if (!publicKeyHex) {
              console.warn(`[tori-core] Agent spec ${file} has signature but no public key`);
            } else {
              const valid = await verifySpecSignature(filePath, spec.signature, publicKeyHex);
              if (!valid) {
                console.warn(`[tori-core] Agent spec ${file} signature verification failed`);
                continue;
              }
            }
          }

          specs.push(spec);
        }
      } catch (err) {
        console.warn(`[tori-core] Failed to load agent spec ${file}:`, (err as Error).message);
      }
    }

    return specs;
  }

  /**
   * Load a prompt file.
   */
  async loadPrompt(relativePath: string): Promise<string | null> {
    const specDir = resolveSpecDir();
    const promptPath = join(specDir, relativePath);
    try {
      return await readFile(promptPath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Load reference prompts.
   */
  async loadReferences(references?: string[]): Promise<string> {
    if (!references || references.length === 0) return "";
    const fragments: string[] = [];
    for (const ref of references) {
      const content = await this.loadPrompt(ref);
      if (content) fragments.push(content);
      else console.warn(`[tori-core] Reference not found: ${ref}`);
    }
    return fragments.join("\n\n");
  }
}

/**
 * Result of compiling all specs.
 */
export interface CompilationResult {
  agents: Agent[];
  roles: Role[];
  capabilities: Capability[];
  skills: Skill[];
  tools: Tool[];
  errors: { specId: string; error: string }[];
  warnings: string[];
}

/**
 * Result of compiling a single spec.
 */
export interface CompiledSpecResult {
  agents: Agent[];
  roles: Role[];
  capabilities: Capability[];
  skills: Skill[];
  tools: Tool[];
  warnings: string[];
}

/**
 * Ontological permissions structure (internal to compiler).
 */
interface OntologicalPermissions {
  capabilities: { id: string; name: string; description: string; scope: string }[];
  tools: { id: string; name: string; description: string; capability_id: string }[];
  roles: { id: string; name: string; description: string; permissions: string[]; capabilities: string[] }[];
  skills: { id: string; name: string; description: string; required_capabilities: string[] }[];
}

/**
 * Convert spec ID to role ID.
 */
function specIdToRoleId(specId: string): string {
  return specId.replace(/[^a-zA-Z0-9]/g, '_');
}