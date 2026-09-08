import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentDefinition,
  CapabilityDefinition,
  OntologyEntity,
  PolicyDefinition,
  RoleDefinition,
  ToolDefinition,
  WorkflowDefinition,
  WorkflowStageDefinition,
  WorkflowTransitionDefinition,
} from "@tori-agent/ontology";
import { ENTITY_TYPES } from "@tori-agent/ontology";
import { OntologyRegistry, DEFAULT_REGISTRY_CONFIG } from "./registry.js";
import { NoopOntologyStore } from "./store.js";
import { getBuiltinOntologySpecDir } from "./paths.js";
import type { OntologyStore } from "../types/registry.js";

export interface CompilationResult {
  graph: OntologyEntity[];
  agents: AgentDefinition[];
  roles: RoleDefinition[];
  capabilities: CapabilityDefinition[];
  tools: ToolDefinition[];
  workflowDefinitions: WorkflowDefinition[];
  workflowStages: WorkflowStageDefinition[];
  workflowTransitions: WorkflowTransitionDefinition[];
  policies: PolicyDefinition[];
  errors: Array<{ specId: string; error: string }>;
  warnings: string[];
}

export class OntologyCompiler {
  private readonly registry: OntologyRegistry;
  private readonly store: OntologyStore;
  private readonly builtinSpecDir: string;
  private readonly sourceDirs: string[];
  private readonly sourceByEntityId = new Map<string, string>();

  constructor(options: { sourceDirs?: string[]; store?: OntologyStore; registry?: OntologyRegistry } = {}) {
    const store = options.store ?? new NoopOntologyStore();
    this.store = store;
    this.registry = options.registry ?? new OntologyRegistry(DEFAULT_REGISTRY_CONFIG, undefined, undefined, store);
    this.registry.setStore(store);
    this.builtinSpecDir = getBuiltinOntologySpecDir();
    this.sourceDirs = options.sourceDirs?.length ? [...options.sourceDirs] : [this.builtinSpecDir];
  }

  async initialize(): Promise<void> {
    await this.store.initialize?.();
  }

  getRegistry(): OntologyRegistry {
    return this.registry;
  }

  async compileAll(): Promise<CompilationResult> {
    const warnings: string[] = [];
    const errors: Array<{ specId: string; error: string }> = [];
    this.sourceByEntityId.clear();
    const entities = await this.loadOntologyEntities(warnings, errors);

    await this.registry.clear();
    for (const entity of entities) {
      const result = await this.registry.register(entity, this.resolveEntitySourcePath(entity["@id"]));
      if (!result.success) {
        errors.push({ specId: entity["@id"], error: result.error ?? "registration failed" });
      }
    }

    const bundle = this.registry.getBundle();
    return {
      graph: bundle.graph,
      agents: bundle.agents,
      roles: bundle.roles,
      capabilities: bundle.capabilities,
      tools: bundle.tools,
      workflowDefinitions: bundle.workflowDefinitions,
      workflowStages: bundle.workflowStages,
      workflowTransitions: bundle.workflowTransitions,
      policies: bundle.policies,
      errors,
      warnings,
    };
  }

  private async loadOntologyEntities(
    warnings: string[],
    errors: Array<{ specId: string; error: string }>,
  ): Promise<OntologyEntity[]> {
    const entityMap = new Map<string, OntologyEntity>();

    for (const sourceDir of this.sourceDirs) {
      const files = await readdir(sourceDir).catch(() => []);
      for (const file of files.filter((entry) => entry.endsWith(".jsonld"))) {
        try {
          const parsed = JSON.parse(await readFile(join(sourceDir, file), "utf8")) as { "@graph"?: OntologyEntity[] };
          if (!Array.isArray(parsed["@graph"])) {
            warnings.push(`${join(sourceDir, file)}: missing @graph`);
            continue;
          }
          for (const entity of parsed["@graph"]) {
            entityMap.set(entity["@id"], entity);
            this.sourceByEntityId.set(entity["@id"], join(sourceDir, file));
          }
        } catch (error) {
          errors.push({ specId: join(sourceDir, file), error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    const entities = Array.from(entityMap.values());
    this.assertStrictOntology(entities);
    return entities;
  }

  private resolveEntitySourcePath(entityId: string): string {
    return this.sourceByEntityId.get(entityId) ?? this.builtinSpecDir;
  }

  private assertStrictOntology(entities: OntologyEntity[]): void {
    for (const entity of entities) {
      if (!entity["@id"] || !entity["@type"] || !entity.label || !entity.description) {
        throw new Error(`Invalid ontology entity ${JSON.stringify(entity)}`);
      }
      switch (entity["@type"]) {
        case ENTITY_TYPES.Agent:
        case ENTITY_TYPES.Role:
        case ENTITY_TYPES.Tool:
        case ENTITY_TYPES.Capability:
        case ENTITY_TYPES.WorkflowDefinition:
        case ENTITY_TYPES.WorkflowStage:
        case ENTITY_TYPES.WorkflowTransition:
        case ENTITY_TYPES.Policy:
          break;
        default:
          throw new Error(`Unsupported ontology entity type: ${entity["@type"]}`);
      }
    }
  }
}
