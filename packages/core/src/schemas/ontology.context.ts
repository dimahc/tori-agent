/**
 * @file packages/core/src/schemas/ontology.context.ts
 * @description JSON-LD Context export for the Tori Agent Ontology (SC-04).
 * Provides the canonical @context mapping for all ontology terms.
 */

import ontologyContextJson from './ontology/context.json' with { type: 'json' };

/**
 * The canonical JSON-LD Context for the Tori Agent Ontology.
 * Maps the namespace https://tori-agent.dev/ontology/2026/core# to short terms.
 */
export const ontologyContext = ontologyContextJson;

export default ontologyContext;
