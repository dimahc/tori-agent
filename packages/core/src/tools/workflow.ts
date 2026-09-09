import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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

interface CachedWorkflowDocument {
  readonly mtimeMs: number;
  readonly size: number;
  readonly document: WorkflowDocument;
  readonly entries: WorkflowEntries;
}

interface CachedWorkflowDirectory {
  readonly mtimeMs: number;
  readonly files: string[];
}

interface WorkflowEntries {
  readonly workflowRun: WorkflowRun;
  readonly taskRecords: WorkflowTaskRecord[];
  readonly checkRecords: WorkflowCheckRecord[];
}

const workflowDocumentCache = new Map<string, CachedWorkflowDocument>();
const workflowDirectoryCache = new Map<string, CachedWorkflowDirectory>();

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

function cloneWorkflowDocument(document: WorkflowDocument): WorkflowDocument {
  return structuredClone(document);
}

function cloneWorkflowEntries(entries: WorkflowEntries): WorkflowEntries {
  return structuredClone(entries);
}

async function readWorkflowCacheEntry(filePath: string): Promise<CachedWorkflowDocument | null> {
  try {
    const metadata = await stat(filePath);
    const cached = workflowDocumentCache.get(filePath);
    if (cached && cached.mtimeMs === metadata.mtimeMs && cached.size === metadata.size) {
      return cached;
    }
    const document = JSON.parse(await readFile(filePath, "utf8")) as WorkflowDocument;
    const entries = splitWorkflowDocument(document);
    const nextCached = { mtimeMs: metadata.mtimeMs, size: metadata.size, document, entries };
    workflowDocumentCache.set(filePath, nextCached);
    return nextCached;
  } catch {
    workflowDocumentCache.delete(filePath);
    return null;
  }
}

async function readWorkflowEntries(runtimePaths: RuntimePaths, workflowRunId: OntologyId): Promise<WorkflowEntries | null> {
  const cached = await readWorkflowCacheEntry(workflowFile(runtimePaths, workflowRunId));
  return cached ? cloneWorkflowEntries(cached.entries) : null;
}

async function listWorkflowFiles(workflowsDir: string): Promise<string[]> {
  await mkdir(workflowsDir, { recursive: true });
  const metadata = await stat(workflowsDir);
  const cached = workflowDirectoryCache.get(workflowsDir);
  if (cached && cached.mtimeMs === metadata.mtimeMs) {
    return [...cached.files];
  }
  const files = (await readdir(workflowsDir)).filter((file) => file.endsWith(".jsonld"));
  workflowDirectoryCache.set(workflowsDir, { mtimeMs: metadata.mtimeMs, files: [...files] });
  return files;
}

async function listWorkflowRunEntries(runtimePaths: RuntimePaths, allowRefresh = true): Promise<WorkflowEntries[]> {
  const files = await listWorkflowFiles(runtimePaths.workflowsDir);
  const entries = await Promise.all(files.map((file) => readWorkflowCacheEntry(join(runtimePaths.workflowsDir, file))));
  if (allowRefresh && entries.some((entry) => entry === null)) {
    workflowDirectoryCache.delete(runtimePaths.workflowsDir);
    return listWorkflowRunEntries(runtimePaths, false);
  }
  return entries
    .filter((entry): entry is CachedWorkflowDocument => entry !== null)
    .map((entry) => cloneWorkflowEntries(entry.entries));
}

async function writeWorkflowDocument(
  runtimePaths: RuntimePaths,
  document: WorkflowDocument,
  workflowRunId: OntologyId,
  options: { readonly listingMayChange?: boolean; readonly entries?: WorkflowEntries } = {},
): Promise<void> {
  const filePath = workflowFile(runtimePaths, workflowRunId);
  const content = JSON.stringify(document, null, 2);
  await mkdir(runtimePaths.workflowsDir, { recursive: true });
  try {
    await writeFile(filePath, content, "utf8");
    const metadata = await stat(filePath);
    workflowDocumentCache.set(filePath, {
      mtimeMs: metadata.mtimeMs,
      size: metadata.size,
      document: cloneWorkflowDocument(document),
      entries: options.entries ? cloneWorkflowEntries(options.entries) : splitWorkflowDocument(document),
    });
    if (options.listingMayChange) workflowDirectoryCache.delete(runtimePaths.workflowsDir);
  } catch (error) {
    workflowDocumentCache.delete(filePath);
    throw error;
  }
}

function splitWorkflowDocument(document: WorkflowDocument): WorkflowEntries {
  const taskRecords: WorkflowTaskRecord[] = [];
  const checkRecords: WorkflowCheckRecord[] = [];
  let workflowRun: WorkflowRun | undefined;

  for (const entry of document["@graph"]) {
    if (entry["@type"] === ENTITY_TYPES.WorkflowRun) {
      workflowRun = entry as WorkflowRun;
      continue;
    }
    if (entry["@type"] === ENTITY_TYPES.WorkflowTaskRecord) {
      taskRecords.push(entry as WorkflowTaskRecord);
      continue;
    }
    if (entry["@type"] === ENTITY_TYPES.WorkflowCheckRecord) {
      checkRecords.push(entry as WorkflowCheckRecord);
    }
  }

  if (!workflowRun) throw new Error("Workflow document missing WorkflowRun entity");
  return { workflowRun, taskRecords, checkRecords };
}

function buildDocument(workflowRun: WorkflowRun, taskRecords: WorkflowTaskRecord[], checkRecords: WorkflowCheckRecord[]): WorkflowDocument {
  return {
    "@context": ONTOLOGY_CONTEXT_IRI,
    "@graph": [workflowRun, ...taskRecords, ...checkRecords],
  };
}

function replaceAndAppendRecord<T extends { "@id": string }>(records: T[], nextRecord: T): T[] {
  const nextRecords: T[] = [];
  for (const record of records) {
    if (record["@id"] !== nextRecord["@id"]) nextRecords.push(record);
  }
  nextRecords.push(nextRecord);
  return nextRecords;
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
  await writeWorkflowDocument(runtimePaths, buildDocument(workflowRun, [], []), workflowRunId, {
    listingMayChange: true,
    entries: { workflowRun, taskRecords: [], checkRecords: [] },
  });
  return workflowRun;
}

export async function listWorkflowRuns(runtimePaths: RuntimePaths): Promise<WorkflowRun[]> {
  const entries = await listWorkflowRunEntries(runtimePaths);
  return entries.map((entry) => entry.workflowRun);
}

export async function getWorkflowState(runtimePaths: RuntimePaths, workflowRunId: OntologyId): Promise<WorkflowStateView | null> {
  const entries = await readWorkflowEntries(runtimePaths, workflowRunId);
  if (!entries) return null;
  const { workflowRun, taskRecords, checkRecords } = entries;
  return {
    workflow_run: workflowRun,
    task_records: taskRecords.map((record) => ({
      "@id": record["@id"],
      label: record.label,
      requesting_agent_id: record.requesting_agent_id,
      result_status_id: record.result_status_id,
      plan_block_name: record.plan_block_name,
      detail: record.detail,
    })),
    task_record_index: workflowRun.task_record_index,
    check_records: checkRecords.map((record) => ({
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
  let entries = await readWorkflowEntries(runtimePaths, workflowRunId);
  if (!entries) {
    if (toStageId !== WORKFLOW_STAGE.requirements) {
      throw new Error(`Workflow run ${workflowRunId} does not exist. First stage must be ${WORKFLOW_STAGE.requirements}`);
    }
    const created = await createWorkflowRun(runtimePaths, workflowRunId);
    ontologyRuntime.getPolicyEngine().ingestWorkflowRun(created);
    return created;
  }

  const { workflowRun, taskRecords, checkRecords } = entries;
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

  const nextEntries = { workflowRun: next, taskRecords, checkRecords: decision.transition.resets_checks ? [] : checkRecords };
  await writeWorkflowDocument(runtimePaths, buildDocument(next, taskRecords, nextEntries.checkRecords), workflowRunId, { entries: nextEntries });
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
  const entries = await readWorkflowEntries(runtimePaths, workflowRunId);
  if (!entries) throw new Error(`Workflow run not found: ${workflowRunId}`);
  const { workflowRun, taskRecords, checkRecords } = entries;
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
  const nextTaskRecords = replaceAndAppendRecord(taskRecords, record);
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
  await writeWorkflowDocument(runtimePaths, buildDocument(nextWorkflowRun, nextTaskRecords, checkRecords), workflowRunId, {
    entries: { workflowRun: nextWorkflowRun, taskRecords: nextTaskRecords, checkRecords },
  });
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
  const entries = await readWorkflowEntries(runtimePaths, workflowRunId);
  if (!entries) throw new Error(`Workflow run not found: ${workflowRunId}`);
  const { workflowRun, taskRecords, checkRecords } = entries;
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
  const nextCheckRecords = replaceAndAppendRecord(checkRecords, record);
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
  await writeWorkflowDocument(runtimePaths, buildDocument(nextWorkflowRun, taskRecords, nextCheckRecords), workflowRunId, {
    entries: { workflowRun: nextWorkflowRun, taskRecords, checkRecords: nextCheckRecords },
  });
  return record;
}
