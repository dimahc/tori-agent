import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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

interface WorkflowDocument {
  "@context": string;
  "@graph": Array<WorkflowRun | WorkflowTaskRecord | WorkflowCheckRecord>;
}

function workflowFile(runtimePaths: RuntimePaths, workflowRunId: OntologyId): string {
  return join(runtimePaths.workflowsDir, `${workflowRunId.replace(/[^a-zA-Z0-9._-]/g, "_")}.jsonld`);
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
    related_artifact_ids: [],
    created_at: now,
    updated_at: now,
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
  if (!decision.allowed || !decision.transition) {
    throw new Error(decision.reason);
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
    updated_at: new Date().toISOString(),
    history: [
      ...workflowRun.history,
      { from_stage_id: workflowRun.stage_id, to_stage_id: toStageId, occurred_at: new Date().toISOString() },
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
  const recordId = `workflow-task:${basename(String(workflowRunId))}:${taskId}`;
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
    updated_at: now,
  };
  await writeWorkflowDocument(runtimePaths, buildDocument(nextWorkflowRun, getTaskRecords(document), nextCheckRecords), workflowRunId);
  return record;
}
