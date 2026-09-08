import {
  ONTOLOGY_CONTEXT_IRI,
  ontologyContext,
  type OntologyEntity,
} from "@tori-agent/ontology";

export type FrameProfile = "compact" | "expanded";

export class JSONLDSerializer {
  async initialize(): Promise<void> {
    return;
  }

  frame<T extends OntologyEntity>(entity: T, profile: FrameProfile = "compact"): T {
    if (profile === "expanded") {
      return {
        ...entity,
        "@context": ontologyContext,
      };
    }

    return {
      ...entity,
      "@context": ONTOLOGY_CONTEXT_IRI,
    };
  }

  serialize<T extends OntologyEntity>(entity: T, profile: FrameProfile = "compact"): string {
    return JSON.stringify(this.frame(entity, profile), null, 2);
  }

  serializeGraph(entities: OntologyEntity[], profile: FrameProfile = "compact"): string {
    const graph = entities.map((entity) => this.frame(entity, profile));
    return JSON.stringify(
      {
        "@context": profile === "expanded" ? ontologyContext : ONTOLOGY_CONTEXT_IRI,
        "@graph": graph,
      },
      null,
      2,
    );
  }
}

export async function serializeEntity<T extends OntologyEntity>(entity: T): Promise<string> {
  const serializer = new JSONLDSerializer();
  await serializer.initialize();
  return serializer.serialize(entity);
}
