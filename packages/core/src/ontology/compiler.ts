import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { FileSystemOntologyStore } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = join(__dirname, "..", "..", "spec", "ontology");

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
  private readonly store: FileSystemOntologyStore;

  constructor(store = new FileSystemOntologyStore(), registry?: OntologyRegistry) {
    this.store = store;
    this.registry = registry ?? new OntologyRegistry(DEFAULT_REGISTRY_CONFIG, undefined, undefined, store);
    this.registry.setStore(store);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  getRegistry(): OntologyRegistry {
    return this.registry;
  }

  async compileAll(): Promise<CompilationResult> {
    const warnings: string[] = [];
    const errors: Array<{ specId: string; error: string }> = [];
    const entities = await this.loadOntologyEntities(warnings, errors);

    await this.registry.clear();
    for (const entity of entities) {
      const result = await this.registry.register(entity, SPEC_DIR);
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
    const files = (await readdir(SPEC_DIR)).filter((file) => file.endsWith(".jsonld"));
    const entities: OntologyEntity[] = [];

    for (const file of files) {
      try {
        const parsed = JSON.parse(await readFile(join(SPEC_DIR, file), "utf8")) as { "@graph"?: OntologyEntity[] };
        if (!Array.isArray(parsed["@graph"])) {
          warnings.push(`${file}: missing @graph`);
          continue;
        }
        entities.push(...parsed["@graph"]);
      } catch (error) {
        errors.push({ specId: file, error: error instanceof Error ? error.message : String(error) });
      }
    }

    this.assertStrictOntology(entities);
    return entities;
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
