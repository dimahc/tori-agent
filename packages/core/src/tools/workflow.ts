import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CHECK_POLICY,
  CHECK_STATUS,
  ENTITY_TYPES,
  EVIDENCE_ANCHOR_KIND,
  ONTOLOGY_CONTEXT_IRI,
  TASK_STATUS,
  WELL_KNOWN_IDS,
  WORKFLOW_STAGE,
  WORKFLOW_STATUS,
  type EvidenceAnchor,
  type OntologyId,
  type RuntimePaths,
  type WorkflowCheckRecord,
  type WorkflowRun,
  type WorkflowTaskRecord,
  type WorkflowTransitionRecord,
} from "@tori-agent/ontology";
import type {
  WorkflowJournalEvidenceSection,
  WorkflowLatestProjectionSection,
  WorkflowProjectionMetadata,
  WorkflowSnapshotSection,
  WorkflowStateView,
} from "../types/workflow.js";
import type { VerificationPolicy } from "../types/verification.js";
import type { OntologyRuntime } from "../ontology/runtime.js";
import { buildWorkflowProgressSignature, normalizeTextUnit } from "../guardrails/output.js";

interface WorkflowEntries {
  readonly workflowRun: WorkflowRun;
  readonly transitionRecords: WorkflowTransitionRecord[];
  readonly taskRecords: WorkflowTaskRecord[];
  readonly checkRecords: WorkflowCheckRecord[];
}

interface CachedWorkflowSnapshot {
  readonly mtimeMs: number;
  readonly size: number;
  readonly entries: WorkflowEntries;
}

interface CachedWorkflowDirectory {
  readonly mtimeMs: number;
  readonly entries: string[];
}

export interface WorkflowEscalationInput {
  reason: string;
  detail: string;
  evidence_anchors: EvidenceAnchor[];
  source_tool_name?: string;
  check_policy_id?: OntologyId;
}

export interface BoundedCognitionStateUpdate {
  investigation_actions?: number;
  search_actions?: number;
  speculation_actions?: number;
  missing_context_failures?: number;
  budget_exhaustion_failures?: number;
  escalation_count?: number;
  last_tool_name?: string;
  last_failure_kind?: "budget-exhausted" | "missing-context";
  last_failure_detail?: string;
  last_failure_at?: string;
}

const workflowSnapshotCache = new Map<string, CachedWorkflowSnapshot>();
const workflowDirectoryCache = new Map<string, CachedWorkflowDirectory>();

const STRICT_WORKFLOW_FORMAT_MESSAGE = "Strict workflow persistence format required. Removed Slice 1 single-file workflow artifact unsupported.";

function defaultLoopState(): NonNullable<WorkflowRun["loop_state"]> {
  return {
    transition_counts: {},
    retry_counts: {},
    no_progress_counts: {},
    progress_signatures: {},
    failure_signatures: {},
    identical_failure_counts: {},
    bounded_cognition: {
      investigation_actions: 0,
      search_actions: 0,
      speculation_actions: 0,
      missing_context_failures: 0,
      budget_exhaustion_failures: 0,
      escalation_count: 0,
    },
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
    bounded_cognition: {
      ...defaultLoopState().bounded_cognition,
      ...(workflowRun.loop_state?.bounded_cognition ?? {}),
    },
  };
}

function transitionKey(fromStageId: OntologyId, toStageId: OntologyId): string {
  return `${fromStageId}->${toStageId}`;
}

function workflowRunBasename(workflowRunId: OntologyId): string {
  return String(workflowRunId).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function workflowRunDir(runtimePaths: RuntimePaths, workflowRunId: OntologyId): string {
  return join(runtimePaths.workflowsDir, workflowRunBasename(workflowRunId));
}

function snapshotFilePath(runtimePaths: RuntimePaths, workflowRunId: OntologyId): string {
  return join(workflowRunDir(runtimePaths, workflowRunId), "snapshot.jsonld");
}

function journalDirPath(runtimePaths: RuntimePaths, workflowRunId: OntologyId): string {
  return join(workflowRunDir(runtimePaths, workflowRunId), "journal");
}

function lockFilePath(runtimePaths: RuntimePaths, workflowRunId: OntologyId): string {
  return join(workflowRunDir(runtimePaths, workflowRunId), ".lock");
}

function sequenceFileName(sequenceNumber: number, recordId: string): string {
  const safeRecordId = String(recordId).replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${String(sequenceNumber).padStart(6, "0")}-${safeRecordId}.jsonld`;
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

function cloneWorkflowLoopState(loopState: WorkflowRun["loop_state"]): WorkflowRun["loop_state"] {
  if (!loopState) return loopState;
  return {
    ...loopState,
    transition_counts: { ...(loopState.transition_counts ?? {}) },
    retry_counts: { ...(loopState.retry_counts ?? {}) },
    no_progress_counts: { ...(loopState.no_progress_counts ?? {}) },
    progress_signatures: { ...(loopState.progress_signatures ?? {}) },
    failure_signatures: { ...(loopState.failure_signatures ?? {}) },
    identical_failure_counts: { ...(loopState.identical_failure_counts ?? {}) },
    bounded_cognition: {
      ...defaultLoopState().bounded_cognition,
      ...(loopState.bounded_cognition ?? {}),
    },
  };
}

function cloneWorkflowRun(workflowRun: WorkflowRun): WorkflowRun {
  return {
    ...workflowRun,
    task_keys: [...workflowRun.task_keys],
    check_keys: [...workflowRun.check_keys],
    task_state_index: Object.fromEntries(
      Object.entries(workflowRun.task_state_index ?? {}).map(([recordId, record]) => [recordId, {
        ...record,
        related_artifact_ids: [...(record.related_artifact_ids ?? [])],
        evidence_anchors: cloneEvidenceAnchors(record.evidence_anchors),
      }]),
    ),
    check_state_index: Object.fromEntries(
      Object.entries(workflowRun.check_state_index ?? {}).map(([recordId, record]) => [recordId, {
        ...record,
        evidence_anchors: cloneEvidenceAnchors(record.evidence_anchors),
      }]),
    ),
    journal_state: { ...workflowRun.journal_state },
    related_artifact_ids: [...workflowRun.related_artifact_ids],
    loop_state: cloneWorkflowLoopState(workflowRun.loop_state),
  };
}

function cloneWorkflowTaskRecord(record: WorkflowTaskRecord): WorkflowTaskRecord {
  return {
    ...record,
    related_artifact_ids: record.related_artifact_ids ? [...record.related_artifact_ids] : undefined,
    evidence_anchors: record.evidence_anchors.map((anchor) => ({ ...anchor })),
  };
}

function cloneWorkflowCheckRecord(record: WorkflowCheckRecord): WorkflowCheckRecord {
  return {
    ...record,
    evidence_anchors: record.evidence_anchors.map((anchor) => ({ ...anchor })),
  };
}

function cloneWorkflowTransitionRecord(record: WorkflowTransitionRecord): WorkflowTransitionRecord {
  return { ...record };
}

function cloneWorkflowEntries(entries: WorkflowEntries): WorkflowEntries {
  return {
    workflowRun: cloneWorkflowRun(entries.workflowRun),
    transitionRecords: entries.transitionRecords.map((record) => cloneWorkflowTransitionRecord(record)),
    taskRecords: entries.taskRecords.map((record) => cloneWorkflowTaskRecord(record)),
    checkRecords: entries.checkRecords.map((record) => cloneWorkflowCheckRecord(record)),
  };
}

function buildSnapshotDocument(workflowRun: WorkflowRun) {
  return {
    "@context": ONTOLOGY_CONTEXT_IRI,
    "@graph": [workflowRun],
  };
}

function buildJournalDocument(record: WorkflowTransitionRecord | WorkflowTaskRecord | WorkflowCheckRecord) {
  return {
    "@context": ONTOLOGY_CONTEXT_IRI,
    "@graph": [record],
  };
}

function isErrnoWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === code;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function strictWorkflowFormatError(filePath: string): Error {
  return new Error(
    `${STRICT_WORKFLOW_FORMAT_MESSAGE} Offending file: ${filePath}. Supported layout: workflows/<workflow-run-slug>/snapshot.jsonld + journal/*.jsonld`,
  );
}

async function listInvalidTopLevelWorkflowFiles(workflowsDir: string): Promise<string[]> {
  await mkdir(workflowsDir, { recursive: true });
  return (await readdir(workflowsDir))
    .filter((name) => name.endsWith(".jsonld"))
    .sort()
    .map((name) => join(workflowsDir, name));
}

async function assertStrictWorkflowLayout(runtimePaths: RuntimePaths): Promise<void> {
  const invalidFiles = await listInvalidTopLevelWorkflowFiles(runtimePaths.workflowsDir);
  if (invalidFiles.length > 0) throw strictWorkflowFormatError(invalidFiles[0]);
}

async function ensureRunLayout(runtimePaths: RuntimePaths, workflowRunId: OntologyId): Promise<void> {
  const runDir = workflowRunDir(runtimePaths, workflowRunId);
  await mkdir(join(runDir, "journal"), { recursive: true });
}

async function withWorkflowLock<T>(runtimePaths: RuntimePaths, workflowRunId: OntologyId, fn: () => Promise<T>): Promise<T> {
  const runDir = workflowRunDir(runtimePaths, workflowRunId);
  await mkdir(runDir, { recursive: true });
  const lockPath = lockFilePath(runtimePaths, workflowRunId);
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (isErrnoWithCode(error, "EEXIST")) {
      throw new Error(`Workflow run locked: ${workflowRunId}`);
    }
    throw error;
  }

  try {
    return await fn();
  } finally {
    await handle?.close();
    await rm(lockPath, { force: true });
  }
}

function parseSingleGraphEntry(document: unknown): WorkflowTransitionRecord | WorkflowTaskRecord | WorkflowCheckRecord {
  if (!document || typeof document !== "object") throw new Error("Invalid journal document");
  const graph = (document as { "@graph"?: unknown })["@graph"];
  if (!Array.isArray(graph) || graph.length !== 1 || !graph[0] || typeof graph[0] !== "object") {
    throw new Error("Journal document must contain exactly one graph entry");
  }
  return graph[0] as WorkflowTransitionRecord | WorkflowTaskRecord | WorkflowCheckRecord;
}

function appendUniqueOntologyIds(existingIds: readonly OntologyId[], nextIds: readonly OntologyId[]): OntologyId[] {
  if (nextIds.length === 0) return [...existingIds];
  const uniqueIds = new Set(existingIds);
  const merged = [...existingIds];
  for (const nextId of nextIds) {
    if (uniqueIds.has(nextId)) continue;
    uniqueIds.add(nextId);
    merged.push(nextId);
  }
  return merged;
}

function cloneEvidenceAnchors(anchors: readonly EvidenceAnchor[]): EvidenceAnchor[] {
  return anchors.map((anchor) => ({ ...anchor }));
}

const VALID_EVIDENCE_ANCHOR_KINDS = new Set<OntologyId>(Object.values(EVIDENCE_ANCHOR_KIND));

function evidenceAnchorKey(anchor: EvidenceAnchor): string {
  return [anchor.anchor_kind_id, anchor.anchor_target, anchor.field_path ?? ""].join("\u0000");
}

function mergeEvidenceAnchors(...groups: readonly EvidenceAnchor[][]): EvidenceAnchor[] {
  const merged: EvidenceAnchor[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const anchor of group) {
      const key = evidenceAnchorKey(anchor);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...anchor });
    }
  }
  return merged;
}

function assertEvidenceAnchors(anchors: readonly EvidenceAnchor[] | undefined, context: string): EvidenceAnchor[] {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    throw new Error(`Durable ${context} requires evidence_anchors`);
  }
  return anchors.map((anchor, index) => {
    if (!anchor || typeof anchor !== "object") throw new Error(`Invalid evidence anchor ${index} for ${context}`);
    if (typeof anchor.anchor_kind_id !== "string" || !VALID_EVIDENCE_ANCHOR_KINDS.has(anchor.anchor_kind_id)) {
      throw new Error(`Evidence anchor ${index} for ${context} missing anchor_kind_id`);
    }
    if (typeof anchor.anchor_target !== "string" || anchor.anchor_target.trim() === "") {
      throw new Error(`Evidence anchor ${index} for ${context} missing anchor_target`);
    }
    if (typeof anchor.anchor_label !== "string" || anchor.anchor_label.trim() === "") {
      throw new Error(`Evidence anchor ${index} for ${context} missing anchor_label`);
    }
    const normalizedAnchor = {
      ...anchor,
      anchor_target: anchor.anchor_target.trim(),
      anchor_label: anchor.anchor_label.trim(),
      anchor_detail: typeof anchor.anchor_detail === "string" && anchor.anchor_detail.trim() ? anchor.anchor_detail.trim() : undefined,
      field_path: typeof anchor.field_path === "string" && anchor.field_path.trim() ? anchor.field_path.trim() : undefined,
    };
    if (normalizedAnchor.anchor_kind_id === EVIDENCE_ANCHOR_KIND.workflowField) {
      if (!normalizedAnchor.field_path) {
        throw new Error(`Workflow-field evidence anchor ${index} for ${context} requires field_path`);
      }
      if (!normalizedAnchor.anchor_target.endsWith(`#${normalizedAnchor.field_path}`)) {
        throw new Error(`Workflow-field evidence anchor ${index} for ${context} must target workflow field path`);
      }
    }
    return normalizedAnchor;
  });
}

function buildWorkflowFieldAnchor(workflowRunId: OntologyId, fieldPath: string, label: string, anchorDetail?: string): EvidenceAnchor {
  return {
    anchor_kind_id: EVIDENCE_ANCHOR_KIND.workflowField,
    anchor_target: `${workflowRunId}#${fieldPath}`,
    anchor_label: label,
    field_path: fieldPath,
    anchor_detail: anchorDetail,
  };
}

function buildJournalRecordAnchor(recordId: OntologyId, label: string, anchorDetail?: string): EvidenceAnchor {
  return {
    anchor_kind_id: EVIDENCE_ANCHOR_KIND.journalRecord,
    anchor_target: recordId,
    anchor_label: label,
    anchor_detail: anchorDetail,
  };
}

function applyBoundedCognitionUpdate(
  workflowRun: WorkflowRun,
  update: BoundedCognitionStateUpdate,
): NonNullable<WorkflowRun["loop_state"]> {
  const loopState = loopStateOf(workflowRun);
  const current = loopState.bounded_cognition;
  loopState.bounded_cognition = {
    ...current,
    investigation_actions: update.investigation_actions ?? current.investigation_actions,
    search_actions: update.search_actions ?? current.search_actions,
    speculation_actions: update.speculation_actions ?? current.speculation_actions,
    missing_context_failures: update.missing_context_failures ?? current.missing_context_failures,
    budget_exhaustion_failures: update.budget_exhaustion_failures ?? current.budget_exhaustion_failures,
    escalation_count: update.escalation_count ?? current.escalation_count,
    last_tool_name: update.last_tool_name ?? current.last_tool_name,
    last_failure_kind: update.last_failure_kind ?? current.last_failure_kind,
    last_failure_detail: update.last_failure_detail ?? current.last_failure_detail,
    last_failure_at: update.last_failure_at ?? current.last_failure_at,
  } as NonNullable<WorkflowRun["loop_state"]>["bounded_cognition"];
  return loopState;
}

function sortRecordsBySequence<T extends { sequence_number: number }>(records: T[]): T[] {
  return [...records].sort((left, right) => left.sequence_number - right.sequence_number);
}

function buildLatestTaskRecords(taskStateIndex: NonNullable<WorkflowRun["task_state_index"]>, taskRecords: WorkflowTaskRecord[]): WorkflowTaskRecord[] {
  const latestIds = new Set(Object.values(taskStateIndex).map((entry) => entry.record_id));
  return sortRecordsBySequence(taskRecords.filter((record) => latestIds.has(record["@id"])));
}

function buildLatestCheckRecords(checkStateIndex: NonNullable<WorkflowRun["check_state_index"]>, checkRecords: WorkflowCheckRecord[]): WorkflowCheckRecord[] {
  const latestIds = new Set(Object.values(checkStateIndex).map((entry) => entry.record_id));
  return sortRecordsBySequence(checkRecords.filter((record) => latestIds.has(record["@id"])));
}

function collectExpectedSequences(entries: WorkflowEntries): number[] {
  return [
    ...entries.transitionRecords.map((record) => record.sequence_number),
    ...entries.taskRecords.map((record) => record.sequence_number),
    ...entries.checkRecords.map((record) => record.sequence_number),
  ].sort((left, right) => left - right);
}

function validateWorkflowEntries(entries: WorkflowEntries): void {
  const latestSequence = entries.workflowRun.journal_state.last_applied_sequence;
  const latestRecordId = entries.workflowRun.journal_state.last_record_id;
  const sequences = collectExpectedSequences(entries);
  if (latestSequence === 0) {
    if (sequences.length > 0) throw new Error(`Workflow snapshot/journal mismatch: expected empty journal for ${entries.workflowRun["@id"]}`);
    return;
  }
  if (sequences.length === 0) {
    throw new Error(`Workflow snapshot missing journal evidence for ${entries.workflowRun["@id"]}`);
  }
  for (let index = 0; index < sequences.length; index += 1) {
    const expected = index + 1;
    if (sequences[index] !== expected) {
      throw new Error(`Workflow journal sequence gap for ${entries.workflowRun["@id"]}: expected ${expected}, got ${sequences[index]}`);
    }
  }
  const journalRecords = [
    ...entries.transitionRecords,
    ...entries.taskRecords,
    ...entries.checkRecords,
  ];
  const latestRecord = journalRecords.find((record) => record.sequence_number === latestSequence);
  if (!latestRecord) {
    throw new Error(`Workflow snapshot missing latest journal record ${latestSequence} for ${entries.workflowRun["@id"]}`);
  }
  if (latestRecord["@id"] !== latestRecordId) {
    throw new Error(`Workflow snapshot latest record mismatch for ${entries.workflowRun["@id"]}: expected ${latestRecordId}, got ${latestRecord["@id"]}`);
  }
  for (const taskKey of entries.workflowRun.task_keys) {
    const snapshot = entries.workflowRun.task_state_index?.[taskKey];
    if (!snapshot) throw new Error(`Workflow snapshot missing task state for ${taskKey}`);
    const record = entries.taskRecords.find((entry) => entry["@id"] === snapshot.record_id);
    if (!record) throw new Error(`Workflow snapshot points to missing task record ${snapshot.record_id}`);
    assertEvidenceAnchors(snapshot.evidence_anchors, `task snapshot ${taskKey}`);
  }
  for (const checkKey of entries.workflowRun.check_keys) {
    const snapshot = entries.workflowRun.check_state_index?.[checkKey];
    if (!snapshot) throw new Error(`Workflow snapshot missing check state for ${checkKey}`);
    const record = entries.checkRecords.find((entry) => entry["@id"] === snapshot.record_id);
    if (!record) throw new Error(`Workflow snapshot points to missing check record ${snapshot.record_id}`);
    assertEvidenceAnchors(snapshot.evidence_anchors, `check snapshot ${checkKey}`);
  }
  for (const record of entries.taskRecords) assertEvidenceAnchors(record.evidence_anchors, `task record ${record["@id"]}`);
  for (const record of entries.checkRecords) assertEvidenceAnchors(record.evidence_anchors, `check record ${record["@id"]}`);
}

function applyJournalRecords(
  workflowRun: WorkflowRun,
  journalRecords: Array<WorkflowTransitionRecord | WorkflowTaskRecord | WorkflowCheckRecord>,
): WorkflowRun {
  const sorted = [...journalRecords].sort((left, right) => left.sequence_number - right.sequence_number);
  const taskKeys: string[] = [...workflowRun.task_keys];
  const checkKeys: OntologyId[] = [...workflowRun.check_keys];
  const taskStateIndex: NonNullable<WorkflowRun["task_state_index"]> = {
    ...(workflowRun.task_state_index ?? {}),
  };
  const checkStateIndex: NonNullable<WorkflowRun["check_state_index"]> = {
    ...(workflowRun.check_state_index ?? {}),
  };
  let currentStageId = workflowRun.stage_id;
  let currentStatusId = workflowRun.status_id;
  let currentIteration = workflowRun.iteration;
  let relatedArtifactIds = [...workflowRun.related_artifact_ids];
  let loopState = loopStateOf(workflowRun);
  let updatedAt = workflowRun.updated_at;

  for (const record of sorted) {
    if (record["@type"] === ENTITY_TYPES.WorkflowTransitionRecord) {
      const transitionRecord = record as WorkflowTransitionRecord;
      currentStageId = transitionRecord.to_stage_id;
      currentStatusId = transitionRecord.next_status_id;
      currentIteration = transitionRecord.iteration;
      updatedAt = transitionRecord.occurred_at;
      if (transitionRecord.resets_checks) {
        for (const key of checkKeys) delete checkStateIndex[key];
        checkKeys.splice(0, checkKeys.length);
        loopState = {
          ...loopState,
          failure_signatures: {},
          identical_failure_counts: {},
        };
      }
      continue;
    }
    if (record["@type"] === ENTITY_TYPES.WorkflowTaskRecord) {
      const taskRecord = record as WorkflowTaskRecord;
      if (!taskKeys.includes(taskRecord.task_key)) taskKeys.push(taskRecord.task_key);
        taskStateIndex[taskRecord.task_key] = {
          record_id: taskRecord["@id"],
          requesting_agent_id: taskRecord.requesting_agent_id,
          result_status_id: taskRecord.result_status_id,
          created_at: taskRecord.created_at,
          updated_at: taskRecord.updated_at,
          plan_block_name: taskRecord.plan_block_name,
          detail: taskRecord.detail,
          related_artifact_ids: taskRecord.related_artifact_ids,
          label: taskRecord.label,
          evidence_anchors: cloneEvidenceAnchors(taskRecord.evidence_anchors),
        };
      relatedArtifactIds = appendUniqueOntologyIds(relatedArtifactIds, taskRecord.related_artifact_ids ?? []);
      updatedAt = taskRecord.updated_at;
      continue;
    }
    const checkRecord = record as WorkflowCheckRecord;
    if (!checkKeys.includes(checkRecord.check_key)) checkKeys.push(checkRecord.check_key);
    checkStateIndex[checkRecord.check_key] = {
      record_id: checkRecord["@id"],
      check_policy_id: checkRecord.check_policy_id,
      result_status_id: checkRecord.result_status_id,
      detail: checkRecord.detail,
      created_at: checkRecord.created_at,
      label: checkRecord.label,
      evidence_anchors: cloneEvidenceAnchors(checkRecord.evidence_anchors),
    };
    const failureKey = `check:${checkRecord.check_key}`;
    const normalizedDetail = normalizeTextUnit(checkRecord.detail);
    if (checkRecord.result_status_id === CHECK_STATUS.failed) {
      loopState.identical_failure_counts[failureKey] = loopState.failure_signatures[failureKey] === normalizedDetail
        ? (loopState.identical_failure_counts[failureKey] ?? 0) + 1
        : 1;
      loopState.failure_signatures[failureKey] = normalizedDetail;
    } else {
      delete loopState.failure_signatures[failureKey];
      delete loopState.identical_failure_counts[failureKey];
    }
    updatedAt = checkRecord.created_at;
  }

  const lastRecord = sorted[sorted.length - 1];
  if (!lastRecord) return workflowRun;
  return {
    ...workflowRun,
    stage_id: currentStageId,
    status_id: currentStatusId,
    iteration: currentIteration,
    task_keys: taskKeys,
    task_state_index: taskStateIndex,
    check_keys: checkKeys,
    check_state_index: checkStateIndex,
    journal_state: {
      last_applied_sequence: lastRecord.sequence_number,
      last_record_id: lastRecord["@id"],
    },
    related_artifact_ids: relatedArtifactIds,
    loop_state: loopState,
    updated_at: updatedAt,
  };
}

async function writeSnapshotFile(runtimePaths: RuntimePaths, workflowRun: WorkflowRun): Promise<void> {
  const snapshotPath = snapshotFilePath(runtimePaths, workflowRun["@id"]);
  const content = JSON.stringify(buildSnapshotDocument(workflowRun), null, 2);
  await mkdir(workflowRunDir(runtimePaths, workflowRun["@id"]), { recursive: true });
  const tempPath = `${snapshotPath}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, snapshotPath);
  const metadata = await stat(snapshotPath);
  workflowSnapshotCache.set(snapshotPath, {
    mtimeMs: metadata.mtimeMs,
    size: metadata.size,
    entries: {
      workflowRun: cloneWorkflowRun(workflowRun),
      transitionRecords: [],
      taskRecords: [],
      checkRecords: [],
    },
  });
}

async function appendJournalRecord(
  runtimePaths: RuntimePaths,
  workflowRunId: OntologyId,
  record: WorkflowTransitionRecord | WorkflowTaskRecord | WorkflowCheckRecord,
): Promise<void> {
  const journalDir = journalDirPath(runtimePaths, workflowRunId);
  await mkdir(journalDir, { recursive: true });
  const filePath = join(journalDir, sequenceFileName(record.sequence_number, record["@id"]));
  const content = JSON.stringify(buildJournalDocument(record), null, 2);
  await writeFile(filePath, content, "utf8");
}

async function readSnapshotOnly(runtimePaths: RuntimePaths, workflowRunId: OntologyId): Promise<WorkflowRun | null> {
  const snapshotPath = snapshotFilePath(runtimePaths, workflowRunId);
  try {
    const metadata = await stat(snapshotPath);
    const cached = workflowSnapshotCache.get(snapshotPath);
    if (cached && cached.mtimeMs === metadata.mtimeMs && cached.size === metadata.size) {
      return cloneWorkflowRun(cached.entries.workflowRun);
    }
    const document = JSON.parse(await readFile(snapshotPath, "utf8")) as { "@graph": WorkflowRun[] };
    if (!Array.isArray(document["@graph"]) || document["@graph"].length !== 1) throw new Error(`Workflow snapshot malformed: ${workflowRunId}`);
    const workflowRun = document["@graph"][0];
    workflowSnapshotCache.set(snapshotPath, {
      mtimeMs: metadata.mtimeMs,
      size: metadata.size,
      entries: { workflowRun, transitionRecords: [], taskRecords: [], checkRecords: [] },
    });
    return cloneWorkflowRun(workflowRun);
  } catch (error) {
    if (isErrnoWithCode(error, "ENOENT")) {
      workflowSnapshotCache.delete(snapshotPath);
      return null;
    }
    throw error;
  }
}

async function listWorkflowRunDirectories(workflowsDir: string): Promise<string[]> {
  await mkdir(workflowsDir, { recursive: true });
  const metadata = await stat(workflowsDir);
  const cached = workflowDirectoryCache.get(workflowsDir);
  if (cached && cached.mtimeMs === metadata.mtimeMs) return [...cached.entries];
  const names = await readdir(workflowsDir);
  const entries: string[] = [];
  for (const name of names) {
    const target = join(workflowsDir, name);
    const targetStat = await stat(target);
    if (targetStat.isDirectory()) entries.push(name);
  }
  workflowDirectoryCache.set(workflowsDir, { mtimeMs: metadata.mtimeMs, entries: [...entries] });
  return entries;
}

async function listJournalRecords(runtimePaths: RuntimePaths, workflowRunId: OntologyId): Promise<Array<WorkflowTransitionRecord | WorkflowTaskRecord | WorkflowCheckRecord>> {
  const journalDir = journalDirPath(runtimePaths, workflowRunId);
  if (!(await exists(journalDir))) return [];
  const files = (await readdir(journalDir)).filter((file) => file.endsWith(".jsonld")).sort();
  const records = await Promise.all(files.map(async (file) => {
    const document = JSON.parse(await readFile(join(journalDir, file), "utf8"));
    return parseSingleGraphEntry(document);
  }));
  return records.sort((left, right) => left.sequence_number - right.sequence_number);
}

async function loadWorkflowEntries(
  runtimePaths: RuntimePaths,
  workflowRunId: OntologyId,
  options: { readonly skipMutationRecovery?: boolean } = {},
): Promise<WorkflowEntries | null> {
  await assertStrictWorkflowLayout(runtimePaths);
  const workflowRun = await readSnapshotOnly(runtimePaths, workflowRunId);
  if (!workflowRun) return null;
  const journalRecords = await listJournalRecords(runtimePaths, workflowRunId);
  const transitionRecords = journalRecords.filter((record): record is WorkflowTransitionRecord => record["@type"] === ENTITY_TYPES.WorkflowTransitionRecord);
  const taskRecords = journalRecords.filter((record): record is WorkflowTaskRecord => record["@type"] === ENTITY_TYPES.WorkflowTaskRecord);
  const checkRecords = journalRecords.filter((record): record is WorkflowCheckRecord => record["@type"] === ENTITY_TYPES.WorkflowCheckRecord);

  let effectiveWorkflowRun = workflowRun;
  if (journalRecords.length > workflowRun.journal_state.last_applied_sequence) {
    const tailRecords = journalRecords.filter((record) => record.sequence_number > workflowRun.journal_state.last_applied_sequence);
    effectiveWorkflowRun = applyJournalRecords(workflowRun, tailRecords);
    if (!options.skipMutationRecovery) {
      await withWorkflowLock(runtimePaths, workflowRunId, async () => {
        await writeSnapshotFile(runtimePaths, effectiveWorkflowRun);
      });
    }
  }

  const entries: WorkflowEntries = {
    workflowRun: effectiveWorkflowRun,
    transitionRecords,
    taskRecords,
    checkRecords,
  };
  validateWorkflowEntries(entries);
  return cloneWorkflowEntries(entries);
}

function buildWorkflowProjectionMetadata(runtimePaths: RuntimePaths, workflowRunId: OntologyId): WorkflowProjectionMetadata {
  return {
    surface: "workflow_state",
    classification: "workflow-state-projection",
    authoritative: false,
    generated_at: new Date().toISOString(),
    reproducible_from: ["workflow snapshot", "workflow journal"],
    provenance: {
      workflow_run_id: workflowRunId,
      snapshot_file: snapshotFilePath(runtimePaths, workflowRunId),
      journal_directory: journalDirPath(runtimePaths, workflowRunId),
    },
  };
}

function buildWorkflowSnapshotSection(workflowRun: WorkflowRun): WorkflowSnapshotSection {
  return {
    authority: "authoritative-snapshot",
    workflow_run: workflowRun,
  };
}

function buildWorkflowJournalEvidenceSection(entries: WorkflowEntries): WorkflowJournalEvidenceSection {
  return {
    authority: "append-only-evidence",
    transition_records: entries.transitionRecords.map((record) => cloneWorkflowTransitionRecord(record)),
    task_records: entries.taskRecords.map((record) => cloneWorkflowTaskRecord(record)),
    check_records: entries.checkRecords.map((record) => cloneWorkflowCheckRecord(record)),
  };
}

function buildWorkflowLatestProjectionSection(
  workflowRun: WorkflowRun,
  latestTaskRecords: WorkflowTaskRecord[],
  latestCheckRecords: WorkflowCheckRecord[],
): WorkflowLatestProjectionSection {
  return {
    authority: "latest-only-projection",
    task_records: latestTaskRecords.map((record) => cloneWorkflowTaskRecord(record)),
    task_state_index: workflowRun.task_state_index,
    check_records: latestCheckRecords.map((record) => cloneWorkflowCheckRecord(record)),
    check_state_index: workflowRun.check_state_index,
  };
}

function buildWorkflowBoundedCognitionProjectionSection(workflowRun: WorkflowRun) {
  return {
    authority: "authoritative-snapshot-derived" as const,
    bounded_cognition: { ...loopStateOf(workflowRun).bounded_cognition },
    evidence_anchor_expectation: "durable-decision-relevant-claims-require-anchors" as const,
    durable_claim_anchor_kinds: Object.values(EVIDENCE_ANCHOR_KIND),
  };
}

async function persistMutation(
  runtimePaths: RuntimePaths,
  workflowRunId: OntologyId,
  build: (entries: WorkflowEntries) => {
    workflowRun: WorkflowRun;
    record: WorkflowTransitionRecord | WorkflowTaskRecord | WorkflowCheckRecord;
  },
): Promise<WorkflowEntries> {
  return withWorkflowLock(runtimePaths, workflowRunId, async () => {
    const entries = await loadWorkflowEntries(runtimePaths, workflowRunId, { skipMutationRecovery: true });
    if (!entries) throw new Error(`Workflow run not found: ${workflowRunId}`);
    const next = build(entries);
    await appendJournalRecord(runtimePaths, workflowRunId, next.record);
    await writeSnapshotFile(runtimePaths, next.workflowRun);
    workflowDirectoryCache.delete(runtimePaths.workflowsDir);
    const nextEntries: WorkflowEntries = {
      workflowRun: next.workflowRun,
      transitionRecords:
        next.record["@type"] === ENTITY_TYPES.WorkflowTransitionRecord
          ? [...entries.transitionRecords, next.record as WorkflowTransitionRecord]
          : entries.transitionRecords,
      taskRecords:
        next.record["@type"] === ENTITY_TYPES.WorkflowTaskRecord
          ? [...entries.taskRecords, next.record as WorkflowTaskRecord]
          : entries.taskRecords,
      checkRecords:
        next.record["@type"] === ENTITY_TYPES.WorkflowCheckRecord
          ? [...entries.checkRecords, next.record as WorkflowCheckRecord]
          : entries.checkRecords,
    };
    validateWorkflowEntries(nextEntries);
    return nextEntries;
  });
}

export async function createWorkflowRun(
  runtimePaths: RuntimePaths,
  workflowRunId: OntologyId,
  definitionId: OntologyId = WELL_KNOWN_IDS.orchestrationWorkflow,
  initialStageId: OntologyId = WORKFLOW_STAGE.requirements,
): Promise<WorkflowRun> {
  await assertStrictWorkflowLayout(runtimePaths);
  const existing = await loadWorkflowEntries(runtimePaths, workflowRunId);
  if (existing) return existing.workflowRun;
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
    task_keys: [],
    task_state_index: {},
    check_keys: [],
    check_state_index: {},
    journal_state: {
      last_applied_sequence: 1,
      last_record_id: `workflow-transition-record:${workflowRunBasename(workflowRunId)}:1`,
    },
    related_artifact_ids: [],
    created_at: now,
    updated_at: now,
    loop_state: defaultLoopState(),
  };
  const transitionRecord: WorkflowTransitionRecord = {
    "@id": workflowRun.journal_state.last_record_id,
    "@type": ENTITY_TYPES.WorkflowTransitionRecord,
    label: "workflow-created",
    description: `Workflow created at ${initialStageId}`,
    from_stage_id: null,
    to_stage_id: initialStageId,
    next_status_id: WORKFLOW_STATUS.active,
    occurred_at: now,
    sequence_number: 1,
    iteration: 0,
  };
  await withWorkflowLock(runtimePaths, workflowRunId, async () => {
    await ensureRunLayout(runtimePaths, workflowRunId);
    await appendJournalRecord(runtimePaths, workflowRunId, transitionRecord);
    await writeSnapshotFile(runtimePaths, workflowRun);
    workflowDirectoryCache.delete(runtimePaths.workflowsDir);
  });
  return cloneWorkflowRun(workflowRun);
}

export async function listWorkflowRuns(runtimePaths: RuntimePaths): Promise<WorkflowRun[]> {
  await assertStrictWorkflowLayout(runtimePaths);
  const dirs = await listWorkflowRunDirectories(runtimePaths.workflowsDir);
  const runs = await Promise.all(dirs.map(async (dir) => {
    const snapshotPath = join(runtimePaths.workflowsDir, dir, "snapshot.jsonld");
    const snapshotDocument = JSON.parse(await readFile(snapshotPath, "utf8")) as { "@graph": WorkflowRun[] };
    const workflowRunId = snapshotDocument["@graph"]?.[0]?.["@id"];
    if (typeof workflowRunId !== "string") throw new Error(`Workflow snapshot malformed in ${snapshotPath}`);
    const entries = await loadWorkflowEntries(runtimePaths, workflowRunId);
    return entries?.workflowRun ?? null;
  }));
  return runs.filter((run): run is WorkflowRun => run !== null);
}

export async function getWorkflowState(runtimePaths: RuntimePaths, workflowRunId: OntologyId): Promise<WorkflowStateView | null> {
  const entries = await loadWorkflowEntries(runtimePaths, workflowRunId);
  if (!entries) return null;
  const { workflowRun } = entries;
  const latestTaskRecords = buildLatestTaskRecords(workflowRun.task_state_index ?? {}, entries.taskRecords);
  const latestCheckRecords = buildLatestCheckRecords(workflowRun.check_state_index ?? {}, entries.checkRecords);
  return {
    projection: buildWorkflowProjectionMetadata(runtimePaths, workflowRunId),
    snapshot: buildWorkflowSnapshotSection(workflowRun),
    journal_evidence: buildWorkflowJournalEvidenceSection(entries),
    latest_projections: buildWorkflowLatestProjectionSection(workflowRun, latestTaskRecords, latestCheckRecords),
    bounded_cognition: buildWorkflowBoundedCognitionProjectionSection(workflowRun),
  };
}

export async function transitionStage(
  runtimePaths: RuntimePaths,
  ontologyRuntime: OntologyRuntime,
  workflowRunId: OntologyId,
  toStageId: OntologyId,
  _policy?: VerificationPolicy,
): Promise<WorkflowRun> {
  let entries = await loadWorkflowEntries(runtimePaths, workflowRunId);
  if (!entries) {
    if (toStageId !== WORKFLOW_STAGE.requirements) {
      throw new Error(`Workflow run ${workflowRunId} does not exist. First stage must be ${WORKFLOW_STAGE.requirements}`);
    }
    const created = await createWorkflowRun(runtimePaths, workflowRunId);
    ontologyRuntime.getPolicyEngine().ingestWorkflowRun(created);
    return created;
  }

  const { workflowRun } = entries;
  ontologyRuntime.getPolicyEngine().ingestWorkflowRun(workflowRun);
  const decision = ontologyRuntime.getPolicyEngine().canTransition(workflowRun, toStageId);
  if (!decision.allowed && decision.escalation_stage_id && workflowRun.stage_id !== decision.escalation_stage_id) {
    return transitionStage(runtimePaths, ontologyRuntime, workflowRunId, decision.escalation_stage_id, _policy);
  }
  if (!decision.allowed || !decision.transition) throw new Error(decision.reason);
  const transition = decision.transition;

  const persisted = await persistMutation(runtimePaths, workflowRunId, (currentEntries) => {
    const current = currentEntries.workflowRun;
    const now = new Date().toISOString();
    const nextSequence = current.journal_state.last_applied_sequence + 1;
    const loopState = loopStateOf(current);
    const key = transitionKey(current.stage_id, toStageId);
    loopState.transition_counts[key] = (loopState.transition_counts[key] ?? 0) + 1;
    if (current.stage_id === WORKFLOW_STAGE.verification && toStageId === WORKFLOW_STAGE.execution) {
      loopState.retry_counts[key] = (loopState.retry_counts[key] ?? 0) + 1;
      const progressSignature = buildWorkflowProgressSignature(current);
      const previousSignature = loopState.progress_signatures[key];
      loopState.no_progress_counts[key] = previousSignature === progressSignature
        ? (loopState.no_progress_counts[key] ?? 0) + 1
        : 0;
      loopState.progress_signatures[key] = progressSignature;
    }
    const nextStatusId =
      toStageId === WORKFLOW_STAGE.completed
        ? WORKFLOW_STATUS.completed
        : toStageId === WORKFLOW_STAGE.needsHuman
          ? WORKFLOW_STATUS.blocked
          : WORKFLOW_STATUS.active;
    const record: WorkflowTransitionRecord = {
      "@id": `workflow-transition-record:${workflowRunBasename(workflowRunId)}:${nextSequence}`,
      "@type": ENTITY_TYPES.WorkflowTransitionRecord,
      label: `${current.stage_id}->${toStageId}`,
      description: `Transition ${current.stage_id} -> ${toStageId}`,
      from_stage_id: current.stage_id,
      to_stage_id: toStageId,
      next_status_id: nextStatusId,
      occurred_at: now,
      sequence_number: nextSequence,
      iteration: current.iteration + (transition.increments_iteration ? 1 : 0),
      resets_checks: transition.resets_checks,
    };
    const nextWorkflowRun: WorkflowRun = {
      ...current,
      stage_id: toStageId,
      status_id: nextStatusId,
      iteration: record.iteration,
      check_keys: transition.resets_checks ? [] : current.check_keys,
      check_state_index: transition.resets_checks ? {} : current.check_state_index,
      journal_state: { last_applied_sequence: nextSequence, last_record_id: record["@id"] },
      loop_state: transition.resets_checks
        ? {
            ...loopState,
            failure_signatures: {},
            identical_failure_counts: {},
          }
        : loopState,
      updated_at: now,
    };
    return { workflowRun: nextWorkflowRun, record };
  });
  ontologyRuntime.getPolicyEngine().ingestWorkflowRun(persisted.workflowRun);
  return persisted.workflowRun;
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
  evidenceAnchors: EvidenceAnchor[] = [],
): Promise<WorkflowTaskRecord> {
  const persisted = await persistMutation(runtimePaths, workflowRunId, (entries) => {
    const now = new Date().toISOString();
    const nextSequence = entries.workflowRun.journal_state.last_applied_sequence + 1;
    const recordId = `workflow-task:${workflowRunBasename(workflowRunId)}:${taskId}:${nextSequence}`;
    const previousSnapshot = entries.workflowRun.task_state_index?.[taskId];
    const validatedAnchors = assertEvidenceAnchors(evidenceAnchors, `task ${taskId}`);
    const canonicalAnchors = mergeEvidenceAnchors(validatedAnchors, [
      buildJournalRecordAnchor(recordId, `task journal record ${taskId}`, detail),
      buildWorkflowFieldAnchor(workflowRunId, `task_state_index.${taskId}`, `task snapshot ${taskId}`, detail),
    ]);
    const record: WorkflowTaskRecord = {
      "@id": recordId,
      "@type": ENTITY_TYPES.WorkflowTaskRecord,
      label: taskId,
      description: detail ?? `Task ${taskId}`,
      task_key: taskId,
      sequence_number: nextSequence,
      requesting_agent_id: agentId,
      result_status_id: taskStatusId(statusId),
      created_at: previousSnapshot?.created_at ?? now,
      updated_at: now,
      plan_block_name: planBlockName,
      related_artifact_ids: relatedArtifactIds,
      detail,
      evidence_anchors: cloneEvidenceAnchors(canonicalAnchors),
    };
    const taskKeys = entries.workflowRun.task_keys.includes(taskId)
      ? [...entries.workflowRun.task_keys]
      : [...entries.workflowRun.task_keys, taskId];
    const nextWorkflowRun: WorkflowRun = {
      ...entries.workflowRun,
      task_keys: taskKeys,
      task_state_index: {
        ...(entries.workflowRun.task_state_index ?? {}),
        [taskId]: {
          record_id: recordId,
          requesting_agent_id: record.requesting_agent_id,
          result_status_id: record.result_status_id,
          created_at: record.created_at,
          updated_at: record.updated_at,
          plan_block_name: record.plan_block_name,
          detail: record.detail,
          related_artifact_ids: record.related_artifact_ids,
          label: record.label,
          evidence_anchors: cloneEvidenceAnchors(record.evidence_anchors),
        },
      },
      journal_state: { last_applied_sequence: nextSequence, last_record_id: recordId },
      related_artifact_ids: appendUniqueOntologyIds(entries.workflowRun.related_artifact_ids, relatedArtifactIds),
      updated_at: now,
    };
    return { workflowRun: nextWorkflowRun, record };
  });
  return persisted.taskRecords.at(-1)!;
}

export async function recordCheckResult(
  runtimePaths: RuntimePaths,
  workflowRunId: OntologyId,
  checkId: OntologyId,
  statusId: string,
  detail: string,
  checkPolicyId: OntologyId = CHECK_POLICY.blocking,
  evidenceAnchors: EvidenceAnchor[] = [],
): Promise<WorkflowCheckRecord> {
  const persisted = await persistMutation(runtimePaths, workflowRunId, (entries) => {
    const now = new Date().toISOString();
    const nextSequence = entries.workflowRun.journal_state.last_applied_sequence + 1;
    const recordId = `workflow-check:${workflowRunBasename(workflowRunId)}:${String(checkId).replace(/[^a-zA-Z0-9._-]/g, "_")}:${nextSequence}`;
    const validatedAnchors = assertEvidenceAnchors(evidenceAnchors, `check ${checkId}`);
    const canonicalAnchors = mergeEvidenceAnchors(validatedAnchors, [
      buildJournalRecordAnchor(recordId, `check journal record ${checkId}`, detail),
      buildWorkflowFieldAnchor(workflowRunId, `check_state_index.${String(checkId)}`, `check snapshot ${String(checkId)}`, detail),
    ]);
    const record: WorkflowCheckRecord = {
      "@id": recordId,
      "@type": ENTITY_TYPES.WorkflowCheckRecord,
      label: checkId,
      description: detail,
      check_key: checkId,
      sequence_number: nextSequence,
      check_policy_id: checkPolicyId,
      result_status_id: checkStatusId(statusId),
      created_at: now,
      detail,
      evidence_anchors: cloneEvidenceAnchors(canonicalAnchors),
    };
    const loopState = loopStateOf(entries.workflowRun);
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
    const checkKeys = entries.workflowRun.check_keys.includes(checkId)
      ? [...entries.workflowRun.check_keys]
      : [...entries.workflowRun.check_keys, checkId];
    const nextWorkflowRun: WorkflowRun = {
      ...entries.workflowRun,
      check_keys: checkKeys,
      check_state_index: {
        ...(entries.workflowRun.check_state_index ?? {}),
        [checkId]: {
          record_id: recordId,
          check_policy_id: record.check_policy_id,
          result_status_id: record.result_status_id,
          detail: record.detail,
          created_at: record.created_at,
          label: record.label,
          evidence_anchors: cloneEvidenceAnchors(record.evidence_anchors),
        },
      },
      journal_state: { last_applied_sequence: nextSequence, last_record_id: recordId },
      loop_state: loopState,
      updated_at: now,
    };
    return { workflowRun: nextWorkflowRun, record };
  });
  return persisted.checkRecords.at(-1)!;
}

export async function updateWorkflowBoundedCognitionState(
  runtimePaths: RuntimePaths,
  workflowRunId: OntologyId,
  update: BoundedCognitionStateUpdate,
): Promise<WorkflowRun> {
  const persisted = await persistMutation(runtimePaths, workflowRunId, (entries) => {
    const now = new Date().toISOString();
    const nextSequence = entries.workflowRun.journal_state.last_applied_sequence + 1;
    const sanitizedDetail = update.last_failure_detail?.trim();
    const nextLoopState = applyBoundedCognitionUpdate(entries.workflowRun, {
      ...update,
      last_failure_detail: sanitizedDetail,
      last_failure_at: update.last_failure_kind ? (update.last_failure_at ?? now) : update.last_failure_at,
    });
    const record: WorkflowTransitionRecord = {
      "@id": `workflow-transition-record:${workflowRunBasename(workflowRunId)}:${nextSequence}`,
      "@type": ENTITY_TYPES.WorkflowTransitionRecord,
      label: `bounded-cognition:${entries.workflowRun.stage_id}`,
      description: sanitizedDetail ? `Bounded cognition state updated: ${sanitizedDetail}` : "Bounded cognition state updated",
      from_stage_id: entries.workflowRun.stage_id,
      to_stage_id: entries.workflowRun.stage_id,
      next_status_id: entries.workflowRun.status_id,
      occurred_at: now,
      sequence_number: nextSequence,
      iteration: entries.workflowRun.iteration,
    };
    return {
      workflowRun: {
        ...entries.workflowRun,
        journal_state: { last_applied_sequence: nextSequence, last_record_id: record["@id"] },
        loop_state: nextLoopState,
        updated_at: now,
      },
      record,
    };
  });
  return persisted.workflowRun;
}

export async function escalateWorkflowNeedHuman(
  runtimePaths: RuntimePaths,
  ontologyRuntime: OntologyRuntime,
  workflowRunId: OntologyId,
  input: WorkflowEscalationInput,
): Promise<WorkflowRun> {
  const evidenceAnchors = assertEvidenceAnchors(input.evidence_anchors, `workflow escalation ${workflowRunId}`);
  const detail = `${input.reason}: ${input.detail}`.trim();
  await recordCheckResult(
    runtimePaths,
    workflowRunId,
    `check:workflow-escalation:${input.source_tool_name ?? "runtime"}`,
    CHECK_STATUS.failed,
    detail,
    input.check_policy_id ?? CHECK_POLICY.blocking,
    evidenceAnchors,
  );
  const current = await loadWorkflowEntries(runtimePaths, workflowRunId);
  const nextEscalationCount = (current?.workflowRun.loop_state?.bounded_cognition.escalation_count ?? 0) + 1;
  await updateWorkflowBoundedCognitionState(runtimePaths, workflowRunId, {
    escalation_count: nextEscalationCount,
    last_tool_name: input.source_tool_name,
    last_failure_detail: detail,
    last_failure_at: new Date().toISOString(),
  });
  const state = await getWorkflowState(runtimePaths, workflowRunId);
  if (!state) throw new Error(`Workflow run not found for escalation: ${workflowRunId}`);
  if (state.snapshot.workflow_run.stage_id === WORKFLOW_STAGE.needsHuman) return state.snapshot.workflow_run;
  return transitionStage(runtimePaths, ontologyRuntime, workflowRunId, WORKFLOW_STAGE.needsHuman);
}
