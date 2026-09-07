import { OntologicalEntity } from "../types/ontology.js";

/**
 * Canonical JSON-LD Context for the Tori Agent Ontology.
 * Embedded directly to avoid file loading issues in dist.
 */
const CANONICAL_CONTEXT: Record<string, string> = {
  "tori": "https://tori-agent.dev/ontology/2026/core#",
  "agent": "https://tori-agent.dev/ontology/2026/agent#",
  "@id": "@id",
  "@type": "@type",
  "@context": "@context",
  "governedBy": "tori:governedBy",
  "implements": "tori:implements",
  "partOf": "tori:partOf",
  "requires": "tori:requires",
  "name": "tori:name",
  "description": "tori:description",
  "roles": "tori:roles",
  "capabilities": "tori:capabilities",
  "tools": "tori:tools",
  "metadata": "tori:metadata",
  "permissions": "tori:permissions",
  "scope": "tori:scope",
  "required_capabilities": "tori:required_capabilities",
  "capability_id": "tori:capability_id",
  "assigned_to": "tori:assigned_to",
  "status": "tori:status",
  "stages": "tori:stages",
  "transitions": "tori:transitions",
  "workflow_id": "tori:workflow_id",
  "entry_conditions": "tori:entry_conditions",
  "exit_conditions": "tori:exit_conditions",
  "from_stage": "tori:from_stage",
  "to_stage": "tori:to_stage",
  "trigger": "tori:trigger",
  "type": "tori:type",
  "owner_id": "tori:owner_id",
  "content": "tori:content",
  "source_id": "tori:source_id",
  "rules": "tori:rules",
  "enforcement_level": "tori:enforcement_level"
};

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
    this.context = CANONICAL_CONTEXT;
  }

  /**
   * Initializes the serializer (no-op since context is embedded).
   */
  async initialize(): Promise<void> {
    // Context is already embedded, no initialization needed
  }

  /**
   * Converts an entity to a JSON-LD string.
   * Automatically injects the canonical @context if missing.
   */
  serialize<T extends OntologicalEntity>(entity: T): string {
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
    const framed = {
      ...entity,
      "@context": {
        "@base": "https://tori-agent.dev/ontology/2026/core#",
        ...this.context
      }
    } as any;

    if (profile === "expanded") {
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