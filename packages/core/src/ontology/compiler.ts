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
import { ENTITY_TYPES, IMMUTABLE_BUILTIN_ONTOLOGY_IDS as IMMUTABLE_IDS } from "@tori-agent/ontology";
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
      const files = (await readdir(sourceDir).catch(() => [])).filter((entry) => entry.endsWith(".jsonld")).sort();
      const parsedFiles = await Promise.all(files.map(async (file) => {
        const filePath = join(sourceDir, file);
        try {
          return {
            file,
            filePath,
            parsed: JSON.parse(await readFile(filePath, "utf8")) as { "@graph"?: OntologyEntity[] },
          };
        } catch (error) {
          return {
            file,
            filePath,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }));

      for (const result of parsedFiles) {
        if ("error" in result) {
          errors.push({ specId: result.filePath, error: result.error ?? "failed to parse ontology file" });
          continue;
        }
        if (!Array.isArray(result.parsed["@graph"])) {
          warnings.push(`${result.filePath}: missing @graph`);
          continue;
        }
        for (const entity of result.parsed["@graph"]) {
          const existingSource = this.sourceByEntityId.get(entity["@id"]);
          if (
            sourceDir !== this.builtinSpecDir &&
            existingSource?.startsWith(this.builtinSpecDir) &&
            (IMMUTABLE_IDS as readonly string[]).includes(entity["@id"])
          ) {
            warnings.push(`${result.filePath} attempted override of immutable builtin ontology record ${entity["@id"]}; ignored`);
            continue;
          }
          entityMap.set(entity["@id"], entity);
          this.sourceByEntityId.set(entity["@id"], result.filePath);
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
