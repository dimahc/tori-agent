/**
 * @file packages/core/src/ontology/compiler.ts
 * @description Compiles ontology-native JSON-LD specifications into ontological entities.
 * 
 * The compiler loads JSON-LD specs from spec/ontology/ and registers
 * all entities directly into the OntologyRegistry.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
 * ONLY compiles ontology-native JSON-LD specs from spec/ontology/.
 * No legacy YAML support.
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
   * Initialize the compiler (loads registry from store).
   */
  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.registry.initialize();
  }

  /**
   * Get the registry instance.
   */
  getRegistry(): OntologyRegistry {
    return this.registry;
  }

  /**
   * Load and compile ALL ontology-native specs into the ontology.
   * This is the ONLY entry point - no legacy YAML support.
   */
  async compileAll(): Promise<CompilationResult> {
    const specs = await this.loadOntologySpecs();
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
      for (const entity of spec['@graph']) {
        try {
          // Validate entity has required fields
          if (!entity['@id'] || !entity['@type']) {
            result.warnings.push(`Skipping entity without @id/@type: ${JSON.stringify(entity).slice(0, 100)}`);
            continue;
          }

          // Register directly - entities are already in ontological form
          const regResult = await this.registry.register(entity);
          if (!regResult.success) {
            result.errors.push({
              specId: entity['@id'],
              error: regResult.error || 'Registration failed',
            });
            continue;
          }

          // Add to result arrays by type
          switch (entity['@type']) {
            case 'Agent':
              result.agents.push(entity);
              break;
            case 'Role':
              result.roles.push(entity);
              break;
            case 'Capability':
              result.capabilities.push(entity);
              break;
            case 'Skill':
              result.skills.push(entity);
              break;
            case 'Tool':
              result.tools.push(entity);
              break;
          }
        } catch (error) {
          result.errors.push({
            specId: entity['@id'] || 'unknown',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Persist all registered entities
    await this.store.save(this.registry.getAll().reduce((map, e) => map.set(e['@id'], e), new Map()));

    return result;
  }

  /**
   * Load ontology-native specs from spec/ontology/ directory (JSON-LD format).
   * This is the ONLY supported format.
   */
  async loadOntologySpecs(): Promise<{ '@graph': any[] }[]> {
    const specDir = resolveSpecDir();
    const ontologyDir = join(specDir, "ontology");

    let files: string[];
    try {
      files = await readdir(ontologyDir);
    } catch {
      console.warn("[tori-core] spec/ontology/ not found — no ontology-native specs");
      return [];
    }

    const specs: { '@graph': any[] }[] = [];

    for (const file of files) {
      if (!file.endsWith(".jsonld") && !file.endsWith(".json")) continue;

      const filePath = join(ontologyDir, file);
      try {
        const content = await readFile(filePath, "utf-8");
        const spec = JSON.parse(content);
        if (spec && spec['@graph'] && Array.isArray(spec['@graph'])) {
          specs.push(spec);
        }
      } catch (err) {
        console.warn(`[tori-core] Failed to load ontology spec ${file}:`, (err as Error).message);
      }
    }

    return specs;
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
