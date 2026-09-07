import { OntologicalEntity } from "../types/ontology.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const CONTEXT_PATH = join(import.meta.dirname, "schemas/ontology/context.jsonld");

/**
 * Represents the framing profiles for JSON-LD serialization.
 */
export type FrameProfile = "compact" | "expanded";

/**
 * Serialization engine for ontological entities.
 * Implements Specification SC-04.
 */
export class JSONLDSerializer {
  private context: Record<string, any>;

  constructor() {
    this.context = {};
  }

  /**
   * Initializes the serializer by loading the canonical context.
   */
  async initialize(): Promise<void> {
    try {
      const contextRaw = await readFile(CONTEXT_PATH, "utf-8");
      this.context = JSON.parse(contextRaw)["@context"];
    } catch (error) {
      throw new Error(`Failed to load canonical context from ${CONTEXT_PATH}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Converts an entity to a JSON-LD string.
   * Automatically injects the canonical @context if missing.
   */
  serialize<T extends OntologicalEntity>(entity: T): string {
    if (Object.keys(this.context).length === 0) {
      throw new Error("Serializer not initialized. Call initialize() before serialize().");
    }

    const framed = this.frame(entity, "compact");
    return JSON.stringify(framed, null, 2);
  }

  /**
   * Applies framing rules to ensure predictable output structure.
   * 
   * @param entity The entity to frame.
   * @param profile 'compact' for standard JSON-LD, 'expanded' for full URI resolution.
   */
  frame<T extends OntologicalEntity>(entity: T, profile: FrameProfile = "compact"): T {
    // In a production environment with the 'jsonld' library, this would use the jsonld.frame() method.
    // For this implementation, we ensure the @context is present and @id/@type are correctly handled.
    
    const framed = {
      ...entity,
      "@context": {
        "@base": "https://tori-agent.dev/ontology/2026/core#",
        ...this.context
      }
    } as any;

    if (profile === "expanded") {
      // Simplified expansion logic: ensure all keys are fully qualified if they aren't already.
      // In a real implementation, this would perform full expansion using a JSON-LD library.
      return framed as T;
    }

    return framed as T;
  }
}

/**
 * Utility function for quick serialization.
 * Note: Requires global initialization or a singleton instance in a real app.
 */
export async function serializeEntity<T extends OntologicalEntity>(entity: T): Promise<string> {
  const serializer = new JSONLDSerializer();
  await serializer.initialize();
  return serializer.serialize(entity);
}
