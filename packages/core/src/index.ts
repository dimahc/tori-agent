/**
 * @file packages/core/src/index.ts
 * @description Tori Agent Core - Ontology-Oriented Architecture
 * 
 * This is the single entry point for the entire system.
 * The ontology (JSON-LD → SHACL → Datalog) IS the architecture.
 * 
 * Exports:
 * - Ontology: Types, Registry, Compiler, Migration, Store
 * - Policy: Datalog Engine, Policy Engine
 * - Serialization: JSON-LD Serializer, Context
 * - Validation: SHACL Validator
 * - Runtime: OntologyRuntime (plugin entry point)
 * - Plugin Internals: Tool builders, lazy registry, budget executor, skills sync
 */

// Ontology Types
export * from './types/ontology.js';
export * from './types/validation.js';
export * from './types/registry.js';
export * from './types/policy.js';

// Ontology Engine
export { OntologyRegistry, DEFAULT_REGISTRY_CONFIG } from './ontology/registry.js';
export { OntologyCompiler } from './ontology/compiler.js';
export { MigrationEngine, defaultMigrations } from './ontology/migration.js';
export { FileSystemOntologyStore, DEFAULT_STORE_CONFIG } from './ontology/store.js';
export { OntologyRuntime, initializeOntologyRuntime, getOntologyRuntime } from './ontology/runtime.js';

// Policy Engine (Datalog)
export { DatalogEngine } from './policy/datalog.js';
export { PolicyEngineImpl } from './policy/engine.js';
export type { PolicyEngine, Fact, Rule, Atom, Substitution } from './types/policy.js';

// Serialization
export { JSONLDSerializer } from './serialization/jsonld.js';

// Validation
export { ShaclValidator } from './validation/shacl.js';
export type { ValidationIssue, ValidationResult, ShaclShape, ShaclPropertyConstraint, Severity } from './types/validation.js';

// Plugin Internals (for runtime package)
export * from './plugin/index.js';

// Schemas (re-export for external access)
export { ontologySchema } from './schemas/ontology.schema.js';
export { ontologyContext } from './schemas/ontology.context.js';