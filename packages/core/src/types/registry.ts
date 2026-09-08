/**
 * @file packages/core/src/types/registry.ts
 * @description Type definitions for strict ontology registry.
 */

import { OntologyEntity, OntologyId } from './ontology.js';
import { ValidationResult } from './validation.js';

/**
 * Semantic version string (e.g., "1.0.0", "2.1.0-beta").
 */
export type SemVer = string;

/**
 * Migration function signature.
 * Transforms an entity from one schema version to another.
 */
export type MigrationFn = (entity: OntologyEntity) => OntologyEntity;

/**
 * Migration rule mapping a version range to a migration function.
 */
export interface MigrationRule {
  fromVersion: SemVer;
  toVersion: SemVer;
  migrate: MigrationFn;
  description?: string;
}

/**
 * Configuration for the Ontology Registry.
 */
export interface RegistryConfig {
  /** Current schema version of the ontology. */
  schemaVersion: SemVer;
  /** Whether to validate entities on registration. */
  validateOnRegister: boolean;
  /** Whether to auto-migrate entities to current schema version. */
  autoMigrate: boolean;
  /** Custom migration rules. */
  migrationRules: MigrationRule[];
}

/**
 * Result of a registry operation.
 */
export interface RegistryResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  validation?: ValidationResult;
}

/**
 * Query options for registry lookups.
 */
export interface QueryOptions {
  /** Filter by entity type (@type). */
  type?: string;
  /** Filter by relationship (e.g., governedBy, partOf). */
  relation?: string;
  /** Related entity ID for relationship queries. */
  relatedTo?: OntologyId;
  /** Custom predicate filter function. */
  predicate?: (entity: OntologyEntity) => boolean;
  /** Maximum results to return. */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
}

/**
 * Interface for ontology persistence stores.
 */
export interface OntologyStore {
  /** Initialize store backing resources if needed. */
  initialize?(): Promise<void>;
  /** Prepare for a new full snapshot write. */
  beginSave?(): Promise<void>;
  /** Save all entities to the store. */
  save(entities: Map<OntologyId, OntologyEntity>): Promise<void>;
  /** Load all entities from the store. */
  load(): Promise<Map<OntologyId, OntologyEntity>>;
  /** Create a backup of the current state. */
  backup(): Promise<void>;
  /** Restore from the latest backup. */
  restore(): Promise<void>;
  /** Check if store exists. */
  exists(): Promise<boolean>;
}

/**
 * File-based store configuration.
 */
export interface FileSystemStoreConfig {
  /** Base directory for ontology files. */
  baseDir: string;
  /** Whether to pretty-print JSON-LD output. */
  prettyPrint: boolean;
  /** File extension for entity files. */
  extension: string;
}

/**
 * Registry statistics.
 */
export interface RegistryStats {
  totalEntities: number;
  entitiesByType: Record<string, number>;
  schemaVersion: SemVer;
  lastModified: Date;
  validationErrors: number;
}

/**
 * Event types for registry changes.
 */
export type RegistryEventType = 
  | 'entity_registered'
  | 'entity_updated'
  | 'entity_removed'
  | 'entity_migrated'
  | 'registry_cleared'
  | 'validation_failed';

/**
 * Registry event for observers.
 */
export interface RegistryEvent {
  type: RegistryEventType;
  entityId?: OntologyId;
  entityType?: string;
  timestamp: Date;
  details?: Record<string, unknown>;
}

/**
 * Observer callback for registry events.
 */
export type RegistryObserver = (event: RegistryEvent) => void;
