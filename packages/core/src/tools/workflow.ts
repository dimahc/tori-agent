import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CHECK_POLICY,
  CHECK_STATUS,
  ENTITY_TYPES,
  ONTOLOGY_CONTEXT_IRI,
  TASK_STATUS,
  WELL_KNOWN_IDS,
  WORKFLOW_STAGE,
  WORKFLOW_STATUS,
  type OntologyId,
  type RuntimePaths,
  type WorkflowCheckRecord,
  type WorkflowRun,
  type WorkflowTaskRecord,
} from "@tori-agent/ontology";
import type { WorkflowStateView } from "../types/workflow.js";
import type { VerificationPolicy } from "../types/verification.js";
import type { OntologyRuntime } from "../ontology/runtime.js";
import { buildWorkflowProgressSignature, normalizeTextUnit } from "../guardrails/output.js";

interface WorkflowDocument {
  "@context": string;
  "@graph": Array<WorkflowRun | WorkflowTaskRecord | WorkflowCheckRecord>;
}

function defaultLoopState(): NonNullable<WorkflowRun["loop_state"]> {
  return {
    transition_counts: {},
    retry_counts: {},
    no_progress_counts: {},
    progress_signatures: {},
    failure_signatures: {},
    identical_failure_counts: {},
  };
}

function loopStateOf(workflowRun: WorkflowRun): NonNullable<WorkflowRun["loop_state"]> {
  return {
    ...defaultLoopState(),
    ...(workflowRun.loop_state ?? {}),
    transition_counts: { ...(workflowRun.loop_state?.transition_counts ?? {}) },
    retry_counts: { ...(workflowRun.loop_state?.retry_counts ?? {}) },
    no_progress_counts: { ...(workflowRun.loop_state?.no_progress_counts ?? {}) },
    progress_signatures: { ...(workflowRun.loop_state?.progress_signatures ?? {}) },
    failure_signatures: { ...(workflowRun.loop_state?.failure_signatures ?? {}) },
    identical_failure_counts: { ...(workflowRun.loop_state?.identical_failure_counts ?? {}) },
  };
}

function transitionKey(fromStageId: OntologyId, toStageId: OntologyId): string {
  return `${fromStageId}->${toStageId}`;
}

function workflowFileBasename(workflowRunId: OntologyId): string {
  return String(workflowRunId).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function workflowFile(runtimePaths: RuntimePaths, workflowRunId: OntologyId): string {
  return join(runtimePaths.workflowsDir, `${workflowFileBasename(workflowRunId)}.jsonld`);
}

function taskStatusId(status: string): OntologyId {
  switch (status) {
    case TASK_STATUS.pending:
    case TASK_STATUS.running:
    case TASK_STATUS.passed:
    case TASK_STATUS.failed:
      return status;
    default:
      throw new Error(`Strict ontology status required. Got '${status}'`);
  }
}

function checkStatusId(status: string): OntologyId {
  switch (status) {
    case CHECK_STATUS.passed:
    case CHECK_STATUS.failed:
    case CHECK_STATUS.skipped:
      return status;
    default:
      throw new Error(`Strict ontology check status required. Got '${status}'`);
  }
}

async function readWorkflowDocument(runtimePaths: RuntimePaths, workflowRunId: OntologyId): Promise<WorkflowDocument | null> {
  try {
    return JSON.parse(await readFile(workflowFile(runtimePaths, workflowRunId), "utf8")) as WorkflowDocument;
  } catch {
    return null;
  }
}

async function writeWorkflowDocument(runtimePaths: RuntimePaths, document: WorkflowDocument, workflowRunId: OntologyId): Promise<void> {
  await mkdir(runtimePaths.workflowsDir, { recursive: true });
  await writeFile(workflowFile(runtimePaths, workflowRunId), JSON.stringify(document, null, 2), "utf8");
}

function getWorkflowRun(document: WorkflowDocument): WorkflowRun {
  const run = document["@graph"].find((entry) => entry["@type"] === ENTITY_TYPES.WorkflowRun) as WorkflowRun | undefined;
  if (!run) throw new Error("Workflow document missing WorkflowRun entity");
  return run;
}

function getTaskRecords(document: WorkflowDocument): WorkflowTaskRecord[] {
  return document["@graph"].filter((entry): entry is WorkflowTaskRecord => entry["@type"] === ENTITY_TYPES.WorkflowTaskRecord);
}

function getCheckRecords(document: WorkflowDocument): WorkflowCheckRecord[] {
  return document["@graph"].filter((entry): entry is WorkflowCheckRecord => entry["@type"] === ENTITY_TYPES.WorkflowCheckRecord);
}

function buildDocument(workflowRun: WorkflowRun, taskRecords: WorkflowTaskRecord[], checkRecords: WorkflowCheckRecord[]): WorkflowDocument {
  return {
    "@context": ONTOLOGY_CONTEXT_IRI,
    "@graph": [workflowRun, ...taskRecords, ...checkRecords],
  };
}

export async function createWorkflowRun(
  runtimePaths: RuntimePaths,
  workflowRunId: OntologyId,
  definitionId: OntologyId = WELL_KNOWN_IDS.orchestrationWorkflow,
  initialStageId: OntologyId = WORKFLOW_STAGE.requirements,
): Promise<WorkflowRun> {
  const now = new Date().toISOString();
  const workflowRun: WorkflowRun = {
    "@id": workflowRunId,
    "@type": ENTITY_TYPES.WorkflowRun,
    label: workflowRunId,
    description: `Workflow run ${workflowRunId}`,
    definition_id: definitionId,
    stage_id: initialStageId,
    status_id: WORKFLOW_STATUS.active,
    iteration: 0,
    task_record_ids: [],
    check_record_ids: [],
    check_status_index: {},
    check_record_index: {},
    task_record_index: {},
    related_artifact_ids: [],
    created_at: now,
    updated_at: now,
    loop_state: defaultLoopState(),
    history: [{ from_stage_id: null, to_stage_id: initialStageId, occurred_at: now }],
  };
  await writeWorkflowDocument(runtimePaths, buildDocument(workflowRun, [], []), workflowRunId);
  return workflowRun;
}

export async function listWorkflowRuns(runtimePaths: RuntimePaths): Promise<WorkflowRun[]> {
  await mkdir(runtimePaths.workflowsDir, { recursive: true });
  const files = (await readdir(runtimePaths.workflowsDir)).filter((file) => file.endsWith(".jsonld"));
  const runs: WorkflowRun[] = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(join(runtimePaths.workflowsDir, file), "utf8")) as WorkflowDocument;
    runs.push(getWorkflowRun(parsed));
  }
  return runs;
}

export async function getWorkflowState(runtimePaths: RuntimePaths, workflowRunId: OntologyId): Promise<WorkflowStateView | null> {
  const document = await readWorkflowDocument(runtimePaths, workflowRunId);
  if (!document) return null;
  const workflowRun = getWorkflowRun(document);
  return {
    workflow_run: workflowRun,
    task_records: getTaskRecords(document).map((record) => ({
      "@id": record["@id"],
      label: record.label,
      requesting_agent_id: record.requesting_agent_id,
      result_status_id: record.result_status_id,
      plan_block_name: record.plan_block_name,
      detail: record.detail,
    })),
    task_record_index: workflowRun.task_record_index,
    check_records: getCheckRecords(document).map((record) => ({
      "@id": record["@id"],
      label: record.label,
      check_policy_id: record.check_policy_id,
      result_status_id: record.result_status_id,
      detail: record.detail,
    })),
  };
}

export async function transitionStage(
  runtimePaths: RuntimePaths,
  ontologyRuntime: OntologyRuntime,
  workflowRunId: OntologyId,
  toStageId: OntologyId,
  _policy?: VerificationPolicy,
): Promise<WorkflowRun> {
  let document = await readWorkflowDocument(runtimePaths, workflowRunId);
  if (!document) {
    if (toStageId !== WORKFLOW_STAGE.requirements) {
      throw new Error(`Workflow run ${workflowRunId} does not exist. First stage must be ${WORKFLOW_STAGE.requirements}`);
    }
    const created = await createWorkflowRun(runtimePaths, workflowRunId);
    ontologyRuntime.getPolicyEngine().ingestWorkflowRun(created);
    return created;
  }

  const workflowRun = getWorkflowRun(document);
  ontologyRuntime.getPolicyEngine().ingestWorkflowRun(workflowRun);
  const decision = ontologyRuntime.getPolicyEngine().canTransition(workflowRun, toStageId);
  if (!decision.allowed && decision.escalation_stage_id && workflowRun.stage_id !== decision.escalation_stage_id) {
    return transitionStage(runtimePaths, ontologyRuntime, workflowRunId, decision.escalation_stage_id, _policy);
  }
  if (!decision.allowed || !decision.transition) {
    throw new Error(decision.reason);
  }

  const now = new Date().toISOString();
  const loopState = loopStateOf(workflowRun);
  const key = transitionKey(workflowRun.stage_id, toStageId);
  loopState.transition_counts[key] = (loopState.transition_counts[key] ?? 0) + 1;
  if (workflowRun.stage_id === WORKFLOW_STAGE.verification && toStageId === WORKFLOW_STAGE.execution) {
    loopState.retry_counts[key] = (loopState.retry_counts[key] ?? 0) + 1;
    const progressSignature = buildWorkflowProgressSignature(workflowRun);
    const previousSignature = loopState.progress_signatures[key];
    loopState.no_progress_counts[key] = previousSignature === progressSignature
      ? (loopState.no_progress_counts[key] ?? 0) + 1
      : 0;
    loopState.progress_signatures[key] = progressSignature;
  }

  const next: WorkflowRun = {
    ...workflowRun,
    stage_id: toStageId,
    status_id:
      toStageId === WORKFLOW_STAGE.completed
        ? WORKFLOW_STATUS.completed
        : toStageId === WORKFLOW_STAGE.needsHuman
          ? WORKFLOW_STATUS.blocked
          : WORKFLOW_STATUS.active,
    iteration: workflowRun.iteration + (decision.transition.increments_iteration ? 1 : 0),
    check_record_ids: decision.transition.resets_checks ? [] : workflowRun.check_record_ids,
    check_status_index: decision.transition.resets_checks ? {} : workflowRun.check_status_index,
    check_record_index: decision.transition.resets_checks ? {} : workflowRun.check_record_index,
    loop_state: decision.transition.resets_checks
      ? {
          ...loopState,
          failure_signatures: {},
          identical_failure_counts: {},
        }
      : loopState,
    updated_at: now,
    history: [
      ...workflowRun.history,
      { from_stage_id: workflowRun.stage_id, to_stage_id: toStageId, occurred_at: now },
    ],
  };

  const taskRecords = getTaskRecords(document);
  const checkRecords = decision.transition.resets_checks ? [] : getCheckRecords(document);
  document = buildDocument(next, taskRecords, checkRecords);
  await writeWorkflowDocument(runtimePaths, document, workflowRunId);
  ontologyRuntime.getPolicyEngine().ingestWorkflowRun(next);
  return next;
}

export async function recordTaskResult(
  runtimePaths: RuntimePaths,
  workflowRunId: OntologyId,
  taskId: string,
  agentId: OntologyId,
  statusId: string,
  relatedArtifactIds: OntologyId[] = [],
  planBlockName?: string,
  detail?: string,
): Promise<WorkflowTaskRecord> {
  const document = await readWorkflowDocument(runtimePaths, workflowRunId);
  if (!document) throw new Error(`Workflow run not found: ${workflowRunId}`);
  const workflowRun = getWorkflowRun(document);
  const taskRecords = getTaskRecords(document);
  const recordId = `workflow-task:${workflowFileBasename(workflowRunId)}:${taskId}`;
  const now = new Date().toISOString();
  const existing = taskRecords.find((record) => record["@id"] === recordId);
  const record: WorkflowTaskRecord = {
    "@id": recordId,
    "@type": ENTITY_TYPES.WorkflowTaskRecord,
    label: taskId,
    description: detail ?? `Task ${taskId}`,
    requesting_agent_id: agentId,
    result_status_id: taskStatusId(statusId),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    plan_block_name: planBlockName,
    related_artifact_ids: relatedArtifactIds,
    detail,
  };
  const nextTaskRecords = taskRecords.filter((entry) => entry["@id"] !== recordId).concat(record);
  const nextWorkflowRun: WorkflowRun = {
    ...workflowRun,
    task_record_ids: nextTaskRecords.map((entry) => entry["@id"]),
    task_record_index: Object.fromEntries(
      nextTaskRecords.map((entry) => [entry["@id"], {
        requesting_agent_id: entry.requesting_agent_id,
        result_status_id: entry.result_status_id,
        updated_at: entry.updated_at,
        plan_block_name: entry.plan_block_name,
        detail: entry.detail,
        related_artifact_ids: entry.related_artifact_ids,
        label: entry.label,
      }]),
    ),
    related_artifact_ids: Array.from(new Set([...workflowRun.related_artifact_ids, ...relatedArtifactIds])),
    updated_at: now,
  };
  await writeWorkflowDocument(runtimePaths, buildDocument(nextWorkflowRun, nextTaskRecords, getCheckRecords(document)), workflowRunId);
  return record;
}

export async function recordCheckResult(
  runtimePaths: RuntimePaths,
  workflowRunId: OntologyId,
  checkId: OntologyId,
  statusId: string,
  detail: string,
  checkPolicyId: OntologyId = CHECK_POLICY.blocking,
): Promise<WorkflowCheckRecord> {
  const document = await readWorkflowDocument(runtimePaths, workflowRunId);
  if (!document) throw new Error(`Workflow run not found: ${workflowRunId}`);
  const workflowRun = getWorkflowRun(document);
  const checkRecords = getCheckRecords(document);
  const now = new Date().toISOString();
  const existing = checkRecords.find((entry) => entry["@id"] === checkId);
  const record: WorkflowCheckRecord = {
    "@id": checkId,
    "@type": ENTITY_TYPES.WorkflowCheckRecord,
    label: checkId,
    description: detail,
    check_policy_id: checkPolicyId,
    result_status_id: checkStatusId(statusId),
    created_at: existing?.created_at ?? now,
    detail,
  };
  const nextCheckRecords = checkRecords.filter((entry) => entry["@id"] !== checkId).concat(record);
  const loopState = loopStateOf(workflowRun);
  const failureKey = `check:${checkId}`;
  const normalizedDetail = normalizeTextUnit(detail);
  if (record.result_status_id === CHECK_STATUS.failed) {
    loopState.identical_failure_counts[failureKey] = loopState.failure_signatures[failureKey] === normalizedDetail
      ? (loopState.identical_failure_counts[failureKey] ?? 0) + 1
      : 1;
    loopState.failure_signatures[failureKey] = normalizedDetail;
  } else {
    delete loopState.failure_signatures[failureKey];
    delete loopState.identical_failure_counts[failureKey];
  }
  const nextWorkflowRun: WorkflowRun = {
    ...workflowRun,
    check_record_ids: nextCheckRecords.map((entry) => entry["@id"]),
    check_status_index: {
      ...(workflowRun.check_status_index ?? {}),
      [checkId]: record.result_status_id,
    },
    check_record_index: {
      ...(workflowRun.check_record_index ?? {}),
      [checkId]: {
        check_policy_id: record.check_policy_id,
        result_status_id: record.result_status_id,
        detail: record.detail,
        created_at: record.created_at,
        label: record.label,
      },
    },
    loop_state: loopState,
    updated_at: now,
  };
  await writeWorkflowDocument(runtimePaths, buildDocument(nextWorkflowRun, getTaskRecords(document), nextCheckRecords), workflowRunId);
  return record;
}
