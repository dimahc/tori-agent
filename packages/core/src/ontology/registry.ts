/**
 * @file packages/core/src/ontology/registry.ts
 * @description Main Ontology Registry implementation (SC-05).
 * Central system of record for all ontological entities.
 */

import { OntologicalEntity, OntologyId } from '../types/ontology.js';
import {
  RegistryConfig,
  RegistryResult,
  QueryOptions,
  RegistryStats,
  RegistryEvent,
  RegistryEventType,
  RegistryObserver,
  OntologyStore,
  SemVer,
  MigrationRule,
} from '../types/registry.js';
import { ShaclValidator } from '../validation/shacl.js';
import { MigrationEngine } from './migration.js';
import { FileSystemOntologyStore } from './store.js';

/**
 * Default registry configuration.
 */
export const DEFAULT_REGISTRY_CONFIG: RegistryConfig = {
  schemaVersion: '2.0.0',
  validateOnRegister: true,
  autoMigrate: true,
  migrationRules: [],
};

/**
 * Central Ontology Registry - System of Record for the Neuro-symbolic Triad.
 * Manages entities, versions, migrations, validation, and persistence.
 */
export class OntologyRegistry {
  private entities: Map<OntologyId, OntologicalEntity> = new Map();
  private typeIndex: Map<string, Set<OntologyId>> = new Map();
  private relationIndex: Map<string, Map<OntologyId, Set<OntologyId>>> = new Map();
  private config: RegistryConfig;
  private validator: ShaclValidator;
  private migrationEngine: MigrationEngine;
  private store: OntologyStore | null = null;
  private observers: Set<RegistryObserver> = new Set();
  private lastModified: Date = new Date();
  private validationErrors: number = 0;

  constructor(
    config: Partial<RegistryConfig> = {},
    validator?: ShaclValidator,
    migrationEngine?: MigrationEngine,
    store?: OntologyStore
  ) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
    this.validator = validator || new ShaclValidator([]);
    this.migrationEngine = migrationEngine || new MigrationEngine(this.config.migrationRules);
    this.store = store || null;
  }

  /**
   * Initialize the registry (load from store if available).
   */
  async initialize(): Promise<void> {
    if (this.store) {
      try {
        const loaded = await this.store.load();
        for (const [id, entity] of loaded) {
          this.indexEntity(entity);
        }
        this.lastModified = new Date();
      } catch (error) {
        console.warn(`Failed to load registry from store: ${error}`);
      }
    }
  }

  /**
   * Set the persistence store.
   */
  setStore(store: OntologyStore): void {
    this.store = store;
  }

  /**
   * Register an entity in the registry.
   * Validates via SHACL, migrates if needed, and indexes.
   */
  async register(entity: OntologicalEntity, filePath?: string): Promise<RegistryResult<OntologicalEntity>> {
    // 1. Validate if enabled
    if (this.config.validateOnRegister) {
      const validation = this.validator.validate(entity['@id'], entity, filePath || 'unknown');
      if (!validation.valid) {
        this.validationErrors++;
        this.emitEvent('validation_failed', entity['@id'], entity['@type'], { issues: validation.issues });
        return {
          success: false,
          error: `SHACL validation failed: ${validation.issues.map(i => i.message).join('; ')}`,
          validation,
        };
      }
    }

    // 2. Auto-migrate if enabled and version differs
    let finalEntity = entity;
    if (this.config.autoMigrate) {
      const currentVersion = this.migrationEngine['getEntityVersion'](entity);
      if (currentVersion !== this.config.schemaVersion && this.migrationEngine.canMigrate(currentVersion, this.config.schemaVersion)) {
        finalEntity = this.migrationEngine.migrate(entity, this.config.schemaVersion);
        this.emitEvent('entity_migrated', finalEntity['@id'], finalEntity['@type'], { fromVersion: currentVersion, toVersion: this.config.schemaVersion });
      }
    }

    // 3. Check if updating or inserting
    const isUpdate = this.entities.has(finalEntity['@id']);
    const oldEntity = this.entities.get(finalEntity['@id']);

    // 4. Remove old indexes if updating
    if (isUpdate && oldEntity) {
      this.removeFromIndexes(oldEntity);
    }

    // 5. Store and index
    this.entities.set(finalEntity['@id'], finalEntity);
    this.indexEntity(finalEntity);
    this.lastModified = new Date();

    // 6. Persist if store available
    if (this.store) {
      try {
        await this.store.save(this.entities);
      } catch (error) {
        console.warn(`Failed to persist registry: ${error}`);
      }
    }

    // 7. Emit event
    this.emitEvent(isUpdate ? 'entity_updated' : 'entity_registered', finalEntity['@id'], finalEntity['@type']);

    return { success: true, data: finalEntity };
  }

  /**
   * Get an entity by ID.
   */
  get(id: OntologyId): OntologicalEntity | undefined {
    return this.entities.get(id);
  }

  /**
   * Get all entities of a specific type.
   */
  getByType(type: string): OntologicalEntity[] {
    const ids = this.typeIndex.get(type);
    if (!ids) return [];
    return Array.from(ids).map(id => this.entities.get(id)!).filter(Boolean);
  }

  /**
   * Query entities with flexible options.
   */
  query(options: QueryOptions = {}): OntologicalEntity[] {
    let results: OntologicalEntity[];

    if (options.relation && options.relatedTo) {
      // Relationship query
      const relationMap = this.relationIndex.get(options.relation);
      if (!relationMap) return [];
      const relatedIds = relationMap.get(options.relatedTo);
      if (!relatedIds) return [];
      results = Array.from(relatedIds).map(id => this.entities.get(id)!).filter(Boolean);
    } else if (options.type) {
      // Type query
      results = this.getByType(options.type);
    } else {
      // Full scan
      results = Array.from(this.entities.values());
    }

    // Apply predicate filter
    if (options.predicate) {
      results = results.filter(options.predicate);
    }

    // Apply pagination
    if (options.offset) {
      results = results.slice(options.offset);
    }
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get entities related to a given entity via a specific relation.
   */
  getRelated(id: OntologyId, relation: string): OntologicalEntity[] {
    const relationMap = this.relationIndex.get(relation);
    if (!relationMap) return [];
    const relatedIds = relationMap.get(id);
    if (!relatedIds) return [];
    return Array.from(relatedIds).map(rid => this.entities.get(rid)!).filter(Boolean);
  }

  /**
   * Remove an entity from the registry.
   */
  async remove(id: OntologyId): Promise<boolean> {
    const entity = this.entities.get(id);
    if (!entity) return false;

    this.removeFromIndexes(entity);
    this.entities.delete(id);
    this.lastModified = new Date();

    if (this.store) {
      try {
        await this.store.save(this.entities);
      } catch (error) {
        console.warn(`Failed to persist registry after removal: ${error}`);
      }
    }

    this.emitEvent('entity_removed', id, entity['@type']);
    return true;
  }

  /**
   * Clear all entities from the registry.
   */
  async clear(): Promise<void> {
    this.entities.clear();
    this.typeIndex.clear();
    this.relationIndex.clear();
    this.lastModified = new Date();
    this.validationErrors = 0;

    if (this.store) {
      try {
        await this.store.save(this.entities);
      } catch (error) {
        console.warn(`Failed to persist registry after clear: ${error}`);
      }
    }

    this.emitEvent('registry_cleared');
  }

  /**
   * Get registry statistics.
   */
  getStats(): RegistryStats {
    const entitiesByType: Record<string, number> = {};
    for (const [type, ids] of this.typeIndex) {
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

  /**
   * Subscribe to registry events.
   */
  subscribe(observer: RegistryObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  /**
   * Emit an event to all observers.
   */
  private emitEvent(
    type: RegistryEventType,
    entityId?: OntologyId,
    entityType?: string,
    details?: Record<string, unknown>
  ): void {
    const event: RegistryEvent = {
      type,
      entityId,
      entityType,
      timestamp: new Date(),
      details,
    };
    for (const observer of this.observers) {
      try {
        observer(event);
      } catch (error) {
        console.error(`Registry observer error: ${error}`);
      }
    }
  }

  /**
   * Index an entity for fast lookups.
   */
  private indexEntity(entity: OntologicalEntity): void {
    // Type index
    const type = entity['@type'];
    if (!this.typeIndex.has(type)) {
      this.typeIndex.set(type, new Set());
    }
    this.typeIndex.get(type)!.add(entity['@id']);

    // Relation indexes
    const relations = ['governedBy', 'implements', 'partOf', 'requires'] as const;
    for (const relation of relations) {
      const value = entity[relation];
      if (value) {
        const targets = Array.isArray(value) ? value : [value];
        for (const targetId of targets) {
          if (!this.relationIndex.has(relation)) {
            this.relationIndex.set(relation, new Map());
          }
          const relMap = this.relationIndex.get(relation)!;
          if (!relMap.has(targetId)) {
            relMap.set(targetId, new Set());
          }
          relMap.get(targetId)!.add(entity['@id']);
        }
      }
    }
  }

  /**
   * Remove an entity from all indexes.
   */
  private removeFromIndexes(entity: OntologicalEntity): void {
    // Type index
    const type = entity['@type'];
    const typeIds = this.typeIndex.get(type);
    if (typeIds) {
      typeIds.delete(entity['@id']);
      if (typeIds.size === 0) {
        this.typeIndex.delete(type);
      }
    }

    // Relation indexes
    const relations = ['governedBy', 'implements', 'partOf', 'requires'] as const;
    for (const relation of relations) {
      const value = entity[relation];
      if (value) {
        const targets = Array.isArray(value) ? value : [value];
        for (const targetId of targets) {
          const relMap = this.relationIndex.get(relation);
          if (relMap) {
            const sourceIds = relMap.get(targetId);
            if (sourceIds) {
              sourceIds.delete(entity['@id']);
              if (sourceIds.size === 0) {
                relMap.delete(targetId);
              }
            }
            if (relMap.size === 0) {
              this.relationIndex.delete(relation);
            }
          }
        }
      }
    }
  }

  /**
   * Get the current schema version.
   */
  getSchemaVersion(): SemVer {
    return this.config.schemaVersion;
  }

  /**
   * Get the migration engine.
   */
  getMigrationEngine(): MigrationEngine {
    return this.migrationEngine;
  }

  /**
   * Get the validator.
   */
  getValidator(): ShaclValidator {
    return this.validator;
  }

  /**
   * Get all entity IDs.
   */
  getAllIds(): OntologyId[] {
    return Array.from(this.entities.keys());
  }

  /**
   * Get all entities.
   */
  getAll(): OntologicalEntity[] {
    return Array.from(this.entities.values());
  }

  /**
   * Check if an entity exists.
   */
  has(id: OntologyId): boolean {
    return this.entities.has(id);
  }

  /**
   * Get entity count by type.
   */
  countByType(type: string): number {
    return this.typeIndex.get(type)?.size || 0;
  }
}