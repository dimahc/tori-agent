import { join } from "node:path";

export type OntologyId = `${string}:${string}` | string;
export type RuntimeId = "opencode" | "kilocode";

export const ONTOLOGY_BASE_IRI = "https://tori-agent.dev/ontology/2026/core#";
export const ONTOLOGY_CONTEXT_IRI = "https://tori-agent.dev/ontology/2026/core/context";
export const ONTOLOGY_SCHEMA_VERSION = "2026.09.0";

export const ontologyContext = {
  "@version": 1.1,
  tori: ONTOLOGY_BASE_IRI,
  "@base": ONTOLOGY_BASE_IRI,
  artifact_id: "tori:artifact_id",
  artifact_ids: "tori:artifact_ids",
  artifact_type_id: "tori:artifact_type_id",
  anchor_detail: "tori:anchor_detail",
  anchor_kind_id: "tori:anchor_kind_id",
  anchor_label: "tori:anchor_label",
  anchor_target: "tori:anchor_target",
  capability_ids: "tori:capability_ids",
  check_policy_id: "tori:check_policy_id",
  check_key: "tori:check_key",
  check_keys: "tori:check_keys",
  check_state_index: "tori:check_state_index",
  command_globs: "tori:command_globs",
  created_at: "tori:created_at",
  definition_id: "tori:definition_id",
  detail: "tori:detail",
  effect: "tori:effect",
  evidence_anchors: "tori:evidence_anchors",
  field_path: "tori:field_path",
  from_stage_id: "tori:from_stage_id",
  from_stage_ids: "tori:from_stage_ids",
  iteration: "tori:iteration",
  journal_state: "tori:journal_state",
  label: "tori:label",
  loop_state: "tori:loop_state",
  last_applied_sequence: "tori:last_applied_sequence",
  last_record_id: "tori:last_record_id",
  max_consecutive_failures: "tori:max_consecutive_failures",
  max_identical_failures: "tori:max_identical_failures",
  max_identical_invocations: "tori:max_identical_invocations",
  max_investigation_actions: "tori:max_investigation_actions",
  max_iteration: "tori:max_iteration",
  max_missing_context_failures: "tori:max_missing_context_failures",
  max_no_progress_retries: "tori:max_no_progress_retries",
  max_repeated_paragraphs: "tori:max_repeated_paragraphs",
  max_repeated_sentences: "tori:max_repeated_sentences",
  max_search_actions: "tori:max_search_actions",
  max_self_talk_markers: "tori:max_self_talk_markers",
  max_speculation_actions: "tori:max_speculation_actions",
  max_transition_retries: "tori:max_transition_retries",
  next_status_id: "tori:next_status_id",
  escalation_stage_id: "tori:escalation_stage_id",
  path_globs: "tori:path_globs",
  policy_kind_id: "tori:policy_kind_id",
  permission_grants: "tori:permission_grants",
  plan_block_name: "tori:plan_block_name",
  prompt_ref: "tori:prompt_ref",
  rationale: "tori:rationale",
  record_id: "tori:record_id",
  related_artifact_ids: "tori:related_artifact_ids",
  requesting_agent_id: "tori:requesting_agent_id",
  required_capability_ids: "tori:required_capability_ids",
  required_check_ids: "tori:required_check_ids",
  required_check_status_id: "tori:required_check_status_id",
  require_failed_check_policy_ids: "tori:require_failed_check_policy_ids",
  resets_checks: "tori:resets_checks",
  result_status_id: "tori:result_status_id",
  role_ids: "tori:role_ids",
  sequence_number: "tori:sequence_number",
  session_id: "tori:session_id",
  stage_id: "tori:stage_id",
  stage_ids: "tori:stage_ids",
  started_at: "tori:started_at",
  status_id: "tori:status_id",
  subject_agent_ids: "tori:subject_agent_ids",
  subject_role_ids: "tori:subject_role_ids",
  task_key: "tori:task_key",
  task_keys: "tori:task_keys",
  task_state_index: "tori:task_state_index",
  tool_id: "tori:tool_id",
  tool_ids: "tori:tool_ids",
  to_stage_id: "tori:to_stage_id",
  to_stage_ids: "tori:to_stage_ids",
  transition_ids: "tori:transition_ids",
  updated_at: "tori:updated_at",
  workflow_definition_id: "tori:workflow_definition_id",
  workflow_definition_ids: "tori:workflow_definition_ids",
  workflow_run_id: "tori:workflow_run_id",
} as const;

export const ENTITY_TYPES = {
  Agent: "Agent",
  Role: "Role",
  Capability: "Capability",
  Tool: "Tool",
  WorkflowDefinition: "WorkflowDefinition",
  WorkflowStage: "WorkflowStage",
  WorkflowTransition: "WorkflowTransition",
  Policy: "Policy",
  WorkflowRun: "WorkflowRun",
  WorkflowTransitionRecord: "WorkflowTransitionRecord",
  WorkflowTaskRecord: "WorkflowTaskRecord",
  WorkflowCheckRecord: "WorkflowCheckRecord",
} as const;

export const POLICY_EFFECT = {
  allow: "policy-effect:allow",
  deny: "policy-effect:deny",
  ask: "policy-effect:ask",
} as const;

export const POLICY_KIND = {
  authorization: "policy-kind:authorization",
  transition: "policy-kind:transition",
  executionLoop: "policy-kind:execution-loop",
  outputGovernance: "policy-kind:output-governance",
} as const;

export const ARTIFACT_TYPE = {
  spec: "artifact-type:spec",
  execPlan: "artifact-type:exec-plan",
  brief: "artifact-type:brief",
  workflowRun: "artifact-type:workflow-run",
  checkpoint: "artifact-type:checkpoint",
} as const;

export const ARTIFACT_STATUS = {
  draft: "artifact-status:draft",
  active: "artifact-status:active",
  completed: "artifact-status:completed",
  archived: "artifact-status:archived",
} as const;

export const WORKFLOW_STATUS = {
  active: "workflow-status:active",
  blocked: "workflow-status:blocked",
  completed: "workflow-status:completed",
} as const;

export const WORKFLOW_STAGE = {
  requirements: "workflow-stage:requirements",
  planning: "workflow-stage:planning",
  execution: "workflow-stage:execution",
  verification: "workflow-stage:verification",
  delivery: "workflow-stage:delivery",
  completed: "workflow-stage:completed",
  needsHuman: "workflow-stage:needs-human",
} as const;

export const TASK_STATUS = {
  pending: "task-status:pending",
  running: "task-status:running",
  passed: "task-status:passed",
  failed: "task-status:failed",
} as const;

export const CHECK_STATUS = {
  passed: "check-status:passed",
  failed: "check-status:failed",
  skipped: "check-status:skipped",
} as const;

export const CHECK_POLICY = {
  blocking: "check-policy:blocking",
  advisory: "check-policy:advisory",
} as const;

export const BOUNDED_COGNITION_CAPABILITY = {
  investigation: "capability:investigation",
  search: "capability:search",
  clarification: "capability:clarification",
} as const;

export const EVIDENCE_ANCHOR_KIND = {
  artifact: "evidence-anchor-kind:artifact",
  workflowField: "evidence-anchor-kind:workflow-field",
  journalRecord: "evidence-anchor-kind:journal-record",
  toolInvocation: "evidence-anchor-kind:tool-invocation",
  policy: "evidence-anchor-kind:policy",
} as const;

export const WELL_KNOWN_IDS = {
  orchestrationWorkflow: "workflow:orchestration-pipeline",
  mechanicalCheck: "check:mechanical",
  lintCheck: "check:lint",
  expansionCheck: "check:verify-expansion",
} as const;

export const IMMUTABLE_BUILTIN_ONTOLOGY_IDS = [
  "agent:tori",
  "role:orchestrator",
  "policy:tori-no-direct-mutation",
] as const;

export const TOOL_IDS = {
  bash: "tool:bash",
  checkArtifacts: "tool:check_artifacts",
  completePlan: "tool:complete_plan",
  glob: "tool:glob",
  grep: "tool:grep",
  jq: "tool:jq",
  markBlockDone: "tool:mark_block_done",
  projectState: "tool:project_state",
  question: "tool:question",
  read: "tool:read",
   structuredRead: "tool:structured_read",
  recordCheckResult: "tool:record_check_result",
  recordTaskResult: "tool:record_task_result",
  registerSpec: "tool:register_spec",
  runMechanicalChecks: "tool:run_mechanical_checks",
  saveCheckpoint: "tool:save_checkpoint",
  scratchpad: "tool:scratchpad",
  skill: "tool:skill",
  task: "tool:task",
  transitionStage: "tool:transition_stage",
  triggerCiCheck: "tool:trigger_ci_check",
  webfetch: "tool:webfetch",
  workflowState: "tool:workflow_state",
  write: "tool:write",
  writeAppend: "tool:write_append",
  edit: "tool:edit",
} as const;

export const TOOL_NAME_TO_ID: Record<string, OntologyId> = {
  bash: TOOL_IDS.bash,
  check_artifacts: TOOL_IDS.checkArtifacts,
  complete_plan: TOOL_IDS.completePlan,
  edit: TOOL_IDS.edit,
  glob: TOOL_IDS.glob,
  grep: TOOL_IDS.grep,
  jq: TOOL_IDS.jq,
  mark_block_done: TOOL_IDS.markBlockDone,
  project_state: TOOL_IDS.projectState,
  question: TOOL_IDS.question,
  read: TOOL_IDS.read,
  structured_read: TOOL_IDS.structuredRead,
  record_check_result: TOOL_IDS.recordCheckResult,
  record_task_result: TOOL_IDS.recordTaskResult,
  register_spec: TOOL_IDS.registerSpec,
  run_mechanical_checks: TOOL_IDS.runMechanicalChecks,
  save_checkpoint: TOOL_IDS.saveCheckpoint,
  scratchpad: TOOL_IDS.scratchpad,
  skill: TOOL_IDS.skill,
  task: TOOL_IDS.task,
  transition_stage: TOOL_IDS.transitionStage,
  trigger_ci_check: TOOL_IDS.triggerCiCheck,
  webfetch: TOOL_IDS.webfetch,
  workflow_state: TOOL_IDS.workflowState,
  write: TOOL_IDS.write,
  write_append: TOOL_IDS.writeAppend,
};

export interface OntologyEntity {
  "@id": OntologyId;
  "@type": string;
  "@context"?: string | Record<string, unknown>;
  label: string;
  description: string;
}

export interface PermissionGrant {
  "@id": OntologyId;
  "@type": "PermissionGrant";
  tool_id: OntologyId;
  effect: (typeof POLICY_EFFECT)[keyof typeof POLICY_EFFECT];
  rationale: string;
  path_globs?: string[];
  command_globs?: string[];
}

export interface CapabilityDefinition extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.Capability;
}

export interface ToolDefinition extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.Tool;
  capability_ids: OntologyId[];
}

export interface RoleDefinition extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.Role;
  capability_ids: OntologyId[];
  permission_grants: PermissionGrant[];
}

export interface AgentDefinition extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.Agent;
  role_ids: OntologyId[];
  capability_ids: OntologyId[];
  tool_ids: OntologyId[];
  prompt_ref: OntologyId;
  metadata: {
    color: string;
    default_main_session?: boolean;
    human_tone: boolean;
    mode: "all" | "subagent";
    temperature: number;
    runtime_ids: RuntimeId[];
  };
}

export interface WorkflowDefinition extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.WorkflowDefinition;
  stage_ids: OntologyId[];
  transition_ids: OntologyId[];
}

export interface WorkflowStageDefinition extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.WorkflowStage;
  workflow_definition_id: OntologyId;
  next_status_id?: OntologyId;
}

export interface WorkflowTransitionDefinition extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.WorkflowTransition;
  workflow_definition_id: OntologyId;
  from_stage_id: OntologyId;
  to_stage_id: OntologyId;
  next_status_id?: OntologyId;
  required_check_ids?: OntologyId[];
  increments_iteration?: boolean;
  resets_checks?: boolean;
}

export interface PolicyDefinition extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.Policy;
  policy_kind_id: OntologyId;
  effect?: (typeof POLICY_EFFECT)[keyof typeof POLICY_EFFECT];
  subject_agent_ids?: OntologyId[];
  subject_role_ids?: OntologyId[];
  capability_ids?: OntologyId[];
  tool_ids?: OntologyId[];
  path_globs?: string[];
  command_globs?: string[];
  workflow_definition_ids?: OntologyId[];
  from_stage_ids?: OntologyId[];
  to_stage_ids?: OntologyId[];
  required_check_ids?: OntologyId[];
  required_check_status_id?: OntologyId;
  require_failed_check_policy_ids?: OntologyId[];
  max_identical_invocations?: number;
  max_identical_failures?: number;
  max_consecutive_failures?: number;
  max_investigation_actions?: number;
  max_search_actions?: number;
  max_missing_context_failures?: number;
  max_transition_retries?: number;
  max_no_progress_retries?: number;
  max_speculation_actions?: number;
  max_iteration?: number;
  escalation_stage_id?: OntologyId;
  max_repeated_paragraphs?: number;
  max_repeated_sentences?: number;
  max_self_talk_markers?: number;
}

export interface EvidenceAnchor {
  anchor_kind_id: OntologyId;
  anchor_target: string;
  anchor_label: string;
  field_path?: string;
  anchor_detail?: string;
}

export interface ExecutionLoopPolicy {
  max_identical_invocations?: number;
  max_identical_failures?: number;
  max_consecutive_failures?: number;
  max_investigation_actions?: number;
  max_search_actions?: number;
  max_speculation_actions?: number;
  max_missing_context_failures?: number;
  escalation_stage_id?: OntologyId;
}

export interface OutputGovernancePolicy {
  max_repeated_paragraphs?: number;
  max_repeated_sentences?: number;
  max_self_talk_markers?: number;
}

export interface WorkflowLoopState {
  transition_counts: Record<string, number>;
  retry_counts: Record<string, number>;
  no_progress_counts: Record<string, number>;
  progress_signatures: Record<string, string>;
  failure_signatures: Record<string, string>;
  identical_failure_counts: Record<string, number>;
  bounded_cognition: {
    investigation_actions: number;
    search_actions: number;
    speculation_actions: number;
    missing_context_failures: number;
    budget_exhaustion_failures: number;
    escalation_count: number;
    last_tool_name?: string;
    last_failure_kind?: "budget-exhausted" | "missing-context";
    last_failure_detail?: string;
    last_failure_at?: string;
  };
}

export interface PersistedWorkflowCheckSnapshot {
  record_id: OntologyId;
  check_policy_id: OntologyId;
  result_status_id: OntologyId;
  detail: string;
  created_at: string;
  label: string;
  evidence_anchors: EvidenceAnchor[];
}

export interface PersistedWorkflowJournalState {
  last_applied_sequence: number;
  last_record_id: OntologyId;
}

export interface WorkflowTransitionRecord extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.WorkflowTransitionRecord;
  from_stage_id: OntologyId | null;
  to_stage_id: OntologyId;
  next_status_id: OntologyId;
  occurred_at: string;
  sequence_number: number;
  iteration: number;
  resets_checks?: boolean;
}

export interface WorkflowTaskRecord extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.WorkflowTaskRecord;
  task_key: string;
  sequence_number: number;
  requesting_agent_id: OntologyId;
  result_status_id: OntologyId;
  created_at: string;
  updated_at: string;
  plan_block_name?: string;
  related_artifact_ids?: OntologyId[];
  detail?: string;
  evidence_anchors: EvidenceAnchor[];
}

export interface PersistedWorkflowTaskSnapshot {
  record_id: OntologyId;
  requesting_agent_id: OntologyId;
  result_status_id: OntologyId;
  created_at: string;
  updated_at: string;
  plan_block_name?: string;
  detail?: string;
  related_artifact_ids?: OntologyId[];
  label: string;
  evidence_anchors: EvidenceAnchor[];
}

export interface WorkflowCheckRecord extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.WorkflowCheckRecord;
  check_key: OntologyId;
  sequence_number: number;
  check_policy_id: OntologyId;
  result_status_id: OntologyId;
  created_at: string;
  detail: string;
  evidence_anchors: EvidenceAnchor[];
}

export interface WorkflowRun extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.WorkflowRun;
  definition_id: OntologyId;
  stage_id: OntologyId;
  status_id: OntologyId;
  iteration: number;
  task_keys: string[];
  task_state_index?: Record<string, PersistedWorkflowTaskSnapshot>;
  check_keys: OntologyId[];
  check_state_index?: Record<string, PersistedWorkflowCheckSnapshot>;
  journal_state: PersistedWorkflowJournalState;
  related_artifact_ids: OntologyId[];
  created_at: string;
  updated_at: string;
  loop_state?: WorkflowLoopState;
  session_id?: string;
}

export interface ManagedArtifactFrontmatter {
  artifact_id: OntologyId;
  artifact_type_id: OntologyId;
  status_id: OntologyId;
  title: string;
  created_at: string;
  updated_at?: string;
  related_artifact_ids?: OntologyId[];
  definition_id?: OntologyId;
  workflow_run_id?: OntologyId;
}

export interface RuntimePaths {
  runtimeId: RuntimeId;
  runtimeRoot: string;
  ontologyDir: string;
  specsDir: string;
  briefsDir: string;
  execPlansDir: string;
  workflowsDir: string;
  checkpointsDir: string;
  scratchpadFile: string;
  skillsDir: string;
}

export interface OntologyBundle {
  graph: OntologyEntity[];
  agents: AgentDefinition[];
  roles: RoleDefinition[];
  capabilities: CapabilityDefinition[];
  tools: ToolDefinition[];
  workflowDefinitions: WorkflowDefinition[];
  workflowStages: WorkflowStageDefinition[];
  workflowTransitions: WorkflowTransitionDefinition[];
  policies: PolicyDefinition[];
  byId: Map<OntologyId, OntologyEntity>;
}

export interface AuthorizationRequest {
  agentId: OntologyId;
  toolName: string;
  toolId: OntologyId;
  pattern?: string | string[];
  runtimePaths: RuntimePaths;
}

export interface AuthorizationDecision {
  effect: "allow" | "deny" | "ask";
  matchedGrantIds: OntologyId[];
  reason: string;
}

export interface TransitionDecision {
  allowed: boolean;
  reason: string;
  transition?: WorkflowTransitionDefinition;
  escalation_stage_id?: OntologyId;
}

export interface MechanicalCheckDefinition {
  id: OntologyId;
  label: string;
  command: string;
  policy: (typeof CHECK_POLICY)[keyof typeof CHECK_POLICY];
  order: number;
}

export interface OntologyShape {
  targetType: string;
  required: string[];
  arrayProperties?: string[];
  objectProperties?: string[];
  enumProperties?: Record<string, string[]>;
}

export const ontologyShapes: OntologyShape[] = [
  {
    targetType: ENTITY_TYPES.Agent,
    required: ["@id", "@type", "label", "description", "role_ids", "capability_ids", "tool_ids", "prompt_ref", "metadata"],
    arrayProperties: ["role_ids", "capability_ids", "tool_ids"],
    objectProperties: ["metadata"],
  },
  {
    targetType: ENTITY_TYPES.Role,
    required: ["@id", "@type", "label", "description", "capability_ids", "permission_grants"],
    arrayProperties: ["capability_ids", "permission_grants"],
  },
  {
    targetType: ENTITY_TYPES.Tool,
    required: ["@id", "@type", "label", "description", "capability_ids"],
    arrayProperties: ["capability_ids"],
  },
  {
    targetType: ENTITY_TYPES.WorkflowDefinition,
    required: ["@id", "@type", "label", "description", "stage_ids", "transition_ids"],
    arrayProperties: ["stage_ids", "transition_ids"],
  },
  {
    targetType: ENTITY_TYPES.WorkflowStage,
    required: ["@id", "@type", "label", "description", "workflow_definition_id"],
  },
  {
    targetType: ENTITY_TYPES.WorkflowTransition,
    required: ["@id", "@type", "label", "description", "workflow_definition_id", "from_stage_id", "to_stage_id"],
    arrayProperties: ["required_check_ids"],
  },
  {
    targetType: ENTITY_TYPES.WorkflowRun,
    required: [
      "@id",
      "@type",
      "label",
      "description",
      "definition_id",
      "stage_id",
      "status_id",
      "iteration",
      "task_keys",
      "check_keys",
      "journal_state",
      "related_artifact_ids",
      "created_at",
      "updated_at",
    ],
    arrayProperties: ["task_keys", "check_keys", "related_artifact_ids"],
    objectProperties: ["task_state_index", "check_state_index", "journal_state", "loop_state"],
  },
  {
    targetType: ENTITY_TYPES.WorkflowTransitionRecord,
    required: [
      "@id",
      "@type",
      "label",
      "description",
      "from_stage_id",
      "to_stage_id",
      "next_status_id",
      "occurred_at",
      "sequence_number",
      "iteration",
    ],
  },
  {
    targetType: ENTITY_TYPES.WorkflowTaskRecord,
    required: ["@id", "@type", "label", "description", "task_key", "sequence_number", "requesting_agent_id", "result_status_id", "created_at", "updated_at", "evidence_anchors"],
    arrayProperties: ["related_artifact_ids", "evidence_anchors"],
  },
  {
    targetType: ENTITY_TYPES.WorkflowCheckRecord,
    required: ["@id", "@type", "label", "description", "check_key", "sequence_number", "check_policy_id", "result_status_id", "created_at", "detail", "evidence_anchors"],
    arrayProperties: ["evidence_anchors"],
  },
  {
    targetType: ENTITY_TYPES.Policy,
    required: ["@id", "@type", "label", "description", "policy_kind_id"],
    arrayProperties: [
      "subject_agent_ids",
      "subject_role_ids",
      "capability_ids",
      "tool_ids",
      "path_globs",
      "command_globs",
      "workflow_definition_ids",
      "from_stage_ids",
      "to_stage_ids",
      "required_check_ids",
      "require_failed_check_policy_ids",
    ],
    enumProperties: {
      policy_kind_id: Object.values(POLICY_KIND),
      effect: Object.values(POLICY_EFFECT),
    },
  },
];

export function buildRuntimePaths(projectRoot: string, runtimeId: RuntimeId, configDir?: string): RuntimePaths {
  const runtimeRoot = join(projectRoot, runtimeId === "opencode" ? ".opencode" : ".kilocode");
  return {
    runtimeId,
    runtimeRoot,
    ontologyDir: join(runtimeRoot, "ontology"),
    specsDir: join(runtimeRoot, "specs"),
    briefsDir: join(runtimeRoot, "briefs"),
    execPlansDir: join(runtimeRoot, "exec-plans"),
    workflowsDir: join(runtimeRoot, "workflows"),
    checkpointsDir: join(runtimeRoot, "checkpoints"),
    scratchpadFile: join(runtimeRoot, "scratchpad.md"),
    skillsDir: join(configDir ?? runtimeRoot, "skills"),
  };
}

export function getToolId(toolName: string): OntologyId {
  return TOOL_NAME_TO_ID[toolName] ?? (`tool:${toolName}` as OntologyId);
}

export function isOntologyId(value: unknown): value is OntologyId {
  return typeof value === "string" && value.includes(":");
}

export function isKnownArtifactTypeId(value: unknown): value is OntologyId {
  return typeof value === "string" && Object.values(ARTIFACT_TYPE).includes(value as (typeof ARTIFACT_TYPE)[keyof typeof ARTIFACT_TYPE]);
}

export function isKnownArtifactStatusId(value: unknown): value is OntologyId {
  return typeof value === "string" && Object.values(ARTIFACT_STATUS).includes(value as (typeof ARTIFACT_STATUS)[keyof typeof ARTIFACT_STATUS]);
}

export function isKnownWorkflowStatusId(value: unknown): value is OntologyId {
  return typeof value === "string" && Object.values(WORKFLOW_STATUS).includes(value as (typeof WORKFLOW_STATUS)[keyof typeof WORKFLOW_STATUS]);
}

export function isKnownWorkflowStageId(value: unknown): value is OntologyId {
  return typeof value === "string" && Object.values(WORKFLOW_STAGE).includes(value as (typeof WORKFLOW_STAGE)[keyof typeof WORKFLOW_STAGE]);
}

export function isKnownTaskStatusId(value: unknown): value is OntologyId {
  return typeof value === "string" && Object.values(TASK_STATUS).includes(value as (typeof TASK_STATUS)[keyof typeof TASK_STATUS]);
}

export function isKnownCheckStatusId(value: unknown): value is OntologyId {
  return typeof value === "string" && Object.values(CHECK_STATUS).includes(value as (typeof CHECK_STATUS)[keyof typeof CHECK_STATUS]);
}

export function isKnownCheckPolicyId(value: unknown): value is OntologyId {
  return typeof value === "string" && Object.values(CHECK_POLICY).includes(value as (typeof CHECK_POLICY)[keyof typeof CHECK_POLICY]);
}

export function slugToOntologyId(prefix: string, slug: string): OntologyId {
  return `${prefix}:${slug}`;
}
