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
    max_identical_invocations: { type: "integer", minimum: 0 },
    max_identical_failures: { type: "integer", minimum: 0 },
    max_consecutive_failures: { type: "integer", minimum: 0 },
    max_transition_retries: { type: "integer", minimum: 0 },
    max_no_progress_retries: { type: "integer", minimum: 0 },
    max_iteration: { type: "integer", minimum: 0 },
    max_repeated_paragraphs: { type: "integer", minimum: 0 },
    max_repeated_sentences: { type: "integer", minimum: 0 },
    max_self_talk_markers: { type: "integer", minimum: 0 },
  },
};

export default ontologySchema;
