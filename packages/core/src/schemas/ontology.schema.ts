import {
  CHECK_POLICY,
  CHECK_STATUS,
  ENTITY_TYPES,
  POLICY_EFFECT,
  POLICY_KIND,
  TASK_STATUS,
  WORKFLOW_STAGE,
  WORKFLOW_STATUS,
} from "@tori-agent/ontology";

export const ontologySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://tori-agent.dev/ontology/2026/core/ontology.schema.json",
  title: "Tori Strict Ontology",
  type: "object",
  required: ["@id", "@type", "label", "description"],
  properties: {
    "@id": { type: "string", pattern: "^[a-z0-9-]+:.+$" },
    "@type": { enum: Object.values(ENTITY_TYPES) },
    label: { type: "string" },
    description: { type: "string" },
    effect: { enum: Object.values(POLICY_EFFECT) },
    policy_kind_id: { enum: Object.values(POLICY_KIND) },
    status_id: { enum: [...Object.values(WORKFLOW_STATUS), ...Object.values(TASK_STATUS), ...Object.values(CHECK_STATUS)] },
    stage_id: { enum: Object.values(WORKFLOW_STAGE) },
    check_policy_id: { enum: Object.values(CHECK_POLICY) },
  },
};

export default ontologySchema;
