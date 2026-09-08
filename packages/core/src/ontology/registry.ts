import {
  ENTITY_TYPES,
  ONTOLOGY_SCHEMA_VERSION,
  type AgentDefinition,
  type CapabilityDefinition,
  type OntologyBundle,
  type OntologyEntity,
  type OntologyId,
  type PolicyDefinition,
  type RoleDefinition,
  type ToolDefinition,
  type WorkflowDefinition,
  type WorkflowStageDefinition,
  type WorkflowTransitionDefinition,
} from "@tori-agent/ontology";
import type {
  OntologyStore,
  QueryOptions,
  RegistryConfig,
  RegistryObserver,
  RegistryResult,
  RegistryStats,
} from "../types/registry.js";
import { ShaclValidator } from "../validation/shacl.js";
import { MigrationEngine } from "./migration.js";

export const DEFAULT_REGISTRY_CONFIG: RegistryConfig = {
  schemaVersion: ONTOLOGY_SCHEMA_VERSION,
  validateOnRegister: true,
  autoMigrate: false,
  migrationRules: [],
};

export class OntologyRegistry {
  private readonly entities = new Map<OntologyId, OntologyEntity>();
  private readonly typeIndex = new Map<string, Set<OntologyId>>();
  private readonly observers = new Set<RegistryObserver>();
  private readonly config: RegistryConfig;
  private readonly validator: ShaclValidator;
  private readonly migrationEngine: MigrationEngine;
  private store: OntologyStore | null;
  private validationErrors = 0;
  private lastModified = new Date();

  constructor(
    config: Partial<RegistryConfig> = {},
    validator = new ShaclValidator(),
    migrationEngine = new MigrationEngine(),
    store: OntologyStore | null = null,
  ) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config, autoMigrate: false };
    this.validator = validator;
    this.migrationEngine = migrationEngine;
    this.store = store;
  }

  async initialize(): Promise<void> {
    if (!this.store) return;
    const loaded = await this.store.load();
    this.entities.clear();
    this.typeIndex.clear();
    for (const [id, entity] of loaded) {
      this.entities.set(id, entity);
      this.indexEntity(entity);
    }
    this.lastModified = new Date();
  }

  setStore(store: OntologyStore): void {
    this.store = store;
  }

  async register(entity: OntologyEntity, filePath = "unknown"): Promise<RegistryResult<OntologyEntity>> {
    if (this.config.validateOnRegister) {
      const validation = this.validator.validate(entity["@id"], entity, filePath);
      if (!validation.valid) {
        this.validationErrors += validation.issues.length;
        return {
          success: false,
          validation,
          error: validation.issues.map((issue) => issue.message).join("; "),
        };
      }
    }

    if (this.config.autoMigrate) {
      return {
        success: false,
        error: "autoMigrate unsupported in strict ontology mode",
      };
    }

    const existing = this.entities.get(entity["@id"]);
    if (existing) {
      this.unindexEntity(existing);
    }
    this.entities.set(entity["@id"], entity);
    this.indexEntity(entity);
    this.lastModified = new Date();
    await this.persist();
    this.emit({
      type: existing ? "entity_updated" : "entity_registered",
      entityId: entity["@id"],
      entityType: entity["@type"],
      timestamp: new Date(),
    });
    return { success: true, data: entity };
  }

  async replaceAll(entities: OntologyEntity[]): Promise<void> {
    this.entities.clear();
    this.typeIndex.clear();
    for (const entity of entities) {
      this.entities.set(entity["@id"], entity);
      this.indexEntity(entity);
    }
    this.lastModified = new Date();
    await this.persist();
  }

  async clear(): Promise<void> {
    this.entities.clear();
    this.typeIndex.clear();
    this.validationErrors = 0;
    this.lastModified = new Date();
    await this.persist();
    this.emit({ type: "registry_cleared", timestamp: new Date() });
  }

  get(id: OntologyId): OntologyEntity | undefined {
    return this.entities.get(id);
  }

  has(id: OntologyId): boolean {
    return this.entities.has(id);
  }

  getAll(): OntologyEntity[] {
    return Array.from(this.entities.values());
  }

  getAllIds(): OntologyId[] {
    return Array.from(this.entities.keys());
  }

  getByType<T extends OntologyEntity = OntologyEntity>(type: string): T[] {
    const ids = this.typeIndex.get(type) ?? new Set<OntologyId>();
    return Array.from(ids)
      .map((id) => this.entities.get(id))
      .filter((entity): entity is T => Boolean(entity));
  }

  query(options: QueryOptions = {}): OntologyEntity[] {
    let results = options.type ? this.getByType(options.type) : this.getAll();
    if (options.relatedTo && options.relation) {
      results = results.filter((entity) => {
        const value = (entity as unknown as Record<string, unknown>)[options.relation!];
        if (Array.isArray(value)) return value.includes(options.relatedTo);
        return value === options.relatedTo;
      });
    }
    if (options.predicate) results = results.filter(options.predicate);
    if (options.offset) results = results.slice(options.offset);
    if (options.limit) results = results.slice(0, options.limit);
    return results;
  }

  getRelated(id: OntologyId, relation: string): OntologyEntity[] {
    return this.getAll().filter((entity) => {
      const value = (entity as unknown as Record<string, unknown>)[relation];
      if (Array.isArray(value)) return value.includes(id);
      return value === id;
    });
  }

  countByType(type: string): number {
    return this.typeIndex.get(type)?.size ?? 0;
  }

  getStats(): RegistryStats {
    const entitiesByType: Record<string, number> = {};
    for (const [type, ids] of this.typeIndex.entries()) {
      entitiesByType[type] = ids.size;
    }
    return {
      totalEntities: this.entities.size,
      entitiesByType,
      schemaVersion: this.config.schemaVersion,
      lastModified: this.lastModified,
      validationErrors: this.validationErrors,
    };
  }

  subscribe(observer: RegistryObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  getValidator(): ShaclValidator {
    return this.validator;
  }

  getMigrationEngine(): MigrationEngine {
    return this.migrationEngine;
  }

  getSchemaVersion(): string {
    return this.config.schemaVersion;
  }

  getBundle(): OntologyBundle {
    const graph = this.getAll();
    return {
      graph,
      agents: this.getByType<AgentDefinition>(ENTITY_TYPES.Agent),
      roles: this.getByType<RoleDefinition>(ENTITY_TYPES.Role),
      capabilities: this.getByType<CapabilityDefinition>(ENTITY_TYPES.Capability),
      tools: this.getByType<ToolDefinition>(ENTITY_TYPES.Tool),
      workflowDefinitions: this.getByType<WorkflowDefinition>(ENTITY_TYPES.WorkflowDefinition),
      workflowStages: this.getByType<WorkflowStageDefinition>(ENTITY_TYPES.WorkflowStage),
      workflowTransitions: this.getByType<WorkflowTransitionDefinition>(ENTITY_TYPES.WorkflowTransition),
      policies: this.getByType<PolicyDefinition>(ENTITY_TYPES.Policy),
      byId: new Map(this.entities),
    };
  }

  getAgent(agentId: OntologyId): AgentDefinition | undefined {
    const entity = this.entities.get(agentId);
    return entity?.["@type"] === ENTITY_TYPES.Agent ? (entity as AgentDefinition) : undefined;
  }

  getRole(roleId: OntologyId): RoleDefinition | undefined {
    const entity = this.entities.get(roleId);
    return entity?.["@type"] === ENTITY_TYPES.Role ? (entity as RoleDefinition) : undefined;
  }

  getTool(toolId: OntologyId): ToolDefinition | undefined {
    const entity = this.entities.get(toolId);
    return entity?.["@type"] === ENTITY_TYPES.Tool ? (entity as ToolDefinition) : undefined;
  }

  private indexEntity(entity: OntologyEntity): void {
    const bucket = this.typeIndex.get(entity["@type"]) ?? new Set<OntologyId>();
    bucket.add(entity["@id"]);
    this.typeIndex.set(entity["@type"], bucket);
  }

  private unindexEntity(entity: OntologyEntity): void {
    const bucket = this.typeIndex.get(entity["@type"]);
    if (!bucket) return;
    bucket.delete(entity["@id"]);
    if (bucket.size === 0) this.typeIndex.delete(entity["@type"]);
  }

  private async persist(): Promise<void> {
    if (!this.store) return;
    await this.store.save(new Map(this.entities));
  }

  private emit(event: Parameters<RegistryObserver>[0]): void {
    for (const observer of this.observers) {
      observer(event);
    }
  }
}
