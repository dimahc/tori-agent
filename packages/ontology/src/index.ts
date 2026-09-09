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
  capability_ids: "tori:capability_ids",
  check_policy_id: "tori:check_policy_id",
  check_record_ids: "tori:check_record_ids",
  check_record_index: "tori:check_record_index",
  command_globs: "tori:command_globs",
  created_at: "tori:created_at",
  definition_id: "tori:definition_id",
  detail: "tori:detail",
  effect: "tori:effect",
  from_stage_id: "tori:from_stage_id",
  from_stage_ids: "tori:from_stage_ids",
  history: "tori:history",
  iteration: "tori:iteration",
  label: "tori:label",
  loop_state: "tori:loop_state",
  max_consecutive_failures: "tori:max_consecutive_failures",
  max_identical_failures: "tori:max_identical_failures",
  max_identical_invocations: "tori:max_identical_invocations",
  max_iteration: "tori:max_iteration",
  max_no_progress_retries: "tori:max_no_progress_retries",
  max_repeated_paragraphs: "tori:max_repeated_paragraphs",
  max_repeated_sentences: "tori:max_repeated_sentences",
  max_self_talk_markers: "tori:max_self_talk_markers",
  max_transition_retries: "tori:max_transition_retries",
  next_status_id: "tori:next_status_id",
  escalation_stage_id: "tori:escalation_stage_id",
  path_globs: "tori:path_globs",
  policy_kind_id: "tori:policy_kind_id",
  permission_grants: "tori:permission_grants",
  plan_block_name: "tori:plan_block_name",
  prompt_ref: "tori:prompt_ref",
  rationale: "tori:rationale",
  related_artifact_ids: "tori:related_artifact_ids",
  requesting_agent_id: "tori:requesting_agent_id",
  required_capability_ids: "tori:required_capability_ids",
  required_check_ids: "tori:required_check_ids",
  required_check_status_id: "tori:required_check_status_id",
  require_failed_check_policy_ids: "tori:require_failed_check_policy_ids",
  resets_checks: "tori:resets_checks",
  result_status_id: "tori:result_status_id",
  role_ids: "tori:role_ids",
  session_id: "tori:session_id",
  stage_id: "tori:stage_id",
  stage_ids: "tori:stage_ids",
  started_at: "tori:started_at",
  status_id: "tori:status_id",
  subject_agent_ids: "tori:subject_agent_ids",
  subject_role_ids: "tori:subject_role_ids",
  task_record_ids: "tori:task_record_ids",
  task_record_index: "tori:task_record_index",
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
  WorkflowTaskRecord: "WorkflowTaskRecord",
  WorkflowCheckRecord: "WorkflowCheckRecord",
} as const;

export const POLICY_EFFECT = {
  allow: "policy-effect:allow",
  deny: "policy-effect:deny",
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
  markBlockDone: "tool:mark_block_done",
  projectState: "tool:project_state",
  question: "tool:question",
  read: "tool:read",
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
  mark_block_done: TOOL_IDS.markBlockDone,
  project_state: TOOL_IDS.projectState,
  question: TOOL_IDS.question,
  read: TOOL_IDS.read,
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
  max_transition_retries?: number;
  max_no_progress_retries?: number;
  max_iteration?: number;
  escalation_stage_id?: OntologyId;
  max_repeated_paragraphs?: number;
  max_repeated_sentences?: number;
  max_self_talk_markers?: number;
}

export interface ExecutionLoopPolicy {
  max_identical_invocations?: number;
  max_identical_failures?: number;
  max_consecutive_failures?: number;
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
}

export interface PersistedWorkflowCheckSnapshot {
  check_policy_id: OntologyId;
  result_status_id: OntologyId;
  detail: string;
  created_at: string;
  label: string;
}

export interface WorkflowTaskRecord extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.WorkflowTaskRecord;
  requesting_agent_id: OntologyId;
  result_status_id: OntologyId;
  created_at: string;
  updated_at: string;
  plan_block_name?: string;
  related_artifact_ids?: OntologyId[];
  detail?: string;
}

export interface PersistedWorkflowTaskSnapshot {
  requesting_agent_id: OntologyId;
  result_status_id: OntologyId;
  updated_at: string;
  plan_block_name?: string;
  detail?: string;
  related_artifact_ids?: OntologyId[];
  label: string;
}

export interface WorkflowCheckRecord extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.WorkflowCheckRecord;
  check_policy_id: OntologyId;
  result_status_id: OntologyId;
  created_at: string;
  detail: string;
}

export interface WorkflowRun extends OntologyEntity {
  "@type": typeof ENTITY_TYPES.WorkflowRun;
  definition_id: OntologyId;
  stage_id: OntologyId;
  status_id: OntologyId;
  iteration: number;
  task_record_ids: OntologyId[];
  task_record_index?: Record<string, PersistedWorkflowTaskSnapshot>;
  check_record_ids: OntologyId[];
  check_status_index?: Record<string, OntologyId>;
  check_record_index?: Record<string, PersistedWorkflowCheckSnapshot>;
  related_artifact_ids: OntologyId[];
  created_at: string;
  updated_at: string;
  loop_state?: WorkflowLoopState;
  history: Array<{
    from_stage_id: OntologyId | null;
    to_stage_id: OntologyId;
    occurred_at: string;
  }>;
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
  effect: "allow" | "deny";
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
      "task_record_ids",
      "check_record_ids",
      "related_artifact_ids",
      "created_at",
      "updated_at",
      "history",
    ],
    arrayProperties: ["task_record_ids", "check_record_ids", "related_artifact_ids", "history"],
    objectProperties: ["task_record_index", "check_status_index", "check_record_index", "loop_state"],
  },
  {
    targetType: ENTITY_TYPES.WorkflowTaskRecord,
    required: ["@id", "@type", "label", "description", "requesting_agent_id", "result_status_id", "created_at", "updated_at"],
    arrayProperties: ["related_artifact_ids"],
  },
  {
    targetType: ENTITY_TYPES.WorkflowCheckRecord,
    required: ["@id", "@type", "label", "description", "check_policy_id", "result_status_id", "created_at", "detail"],
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

export function slugToOntologyId(prefix: string, slug: string): OntologyId {
  return `${prefix}:${slug}`;
}
