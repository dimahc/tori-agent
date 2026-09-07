/**
 * @file packages/core/src/schemas/ontology.schema.ts
 * @description JSON Schema export for the Tori Agent Ontology (SC-01).
 * Draft 2020-12 compliant.
 */

import ontologySchemaJson from './ontology.schema.json' with { type: 'json' };

/**
 * The complete JSON Schema for the Tori Agent Ontology.
 * Validates all 12 core classes: Agent, Role, Capability, Skill, Tool, Task, Workflow, Stage, Transition, Artifact, Knowledge, Policy.
 */
export const ontologySchema = ontologySchemaJson;

export default ontologySchema;