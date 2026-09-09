import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CHECK_POLICY,
  CHECK_STATUS,
  EVIDENCE_ANCHOR_KIND,
  ENTITY_TYPES,
  TASK_STATUS,
  WORKFLOW_STAGE,
  buildRuntimePaths,
} from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";
import {
  createWorkflowRun,
  escalateWorkflowNeedHuman,
  getWorkflowState,
  listWorkflowRuns,
  recordCheckResult,
  recordTaskResult,
  transitionStage,
} from "../dist/tools/workflow.js";

function workflowDir(runtimePaths, workflowRunId) {
  return join(runtimePaths.workflowsDir, workflowRunId.replace(/[^a-zA-Z0-9._-]/g, "_"));
}

function snapshotPath(runtimePaths, workflowRunId) {
  return join(workflowDir(runtimePaths, workflowRunId), "snapshot.jsonld");
}

function journalDir(runtimePaths, workflowRunId) {
  return join(workflowDir(runtimePaths, workflowRunId), "journal");
}

async function readSnapshot(runtimePaths, workflowRunId) {
  return JSON.parse(await readFile(snapshotPath(runtimePaths, workflowRunId), "utf8"));
}

function taskAnchors(taskId, detail = taskId) {
  return [{
    anchor_kind_id: EVIDENCE_ANCHOR_KIND.toolInvocation,
    anchor_target: `task:${taskId}`,
    anchor_label: `task ${taskId}`,
    anchor_detail: detail,
  }];
}

function checkAnchors(checkId, detail = checkId) {
  return [{
    anchor_kind_id: EVIDENCE_ANCHOR_KIND.toolInvocation,
    anchor_target: `check:${checkId}`,
    anchor_label: `check ${checkId}`,
    anchor_detail: detail,
  }];
}

describe("workflow strict ontology", () => {
  let root;
  let runtimePaths;
  let runtime;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tori-workflow-"));
    runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    runtime = await initializeOntologyRuntime();
  });

  test("creates ontology-native workflow run in per-run directory", async () => {
    const run = await createWorkflowRun(runtimePaths, "workflow-run:test");
    assert.equal(run.stage_id, WORKFLOW_STAGE.requirements);
    const stored = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(stored.projection.authoritative, false);
    assert.equal(stored.snapshot.workflow_run["@id"], "workflow-run:test");
    assert.equal(stored.journal_evidence.transition_records.length, 1);
    assert.equal(await stat(snapshotPath(runtimePaths, "workflow-run:test")).then(() => true), true);
    assert.equal((await readdir(journalDir(runtimePaths, "workflow-run:test"))).length, 1);
  });

  test("allows ontology transitions in declared order", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    let run = await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.planning);
    assert.equal(run.stage_id, WORKFLOW_STAGE.planning);
    run = await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    assert.equal(run.iteration, 1);
    run = await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.verification);
    assert.equal(run.stage_id, WORKFLOW_STAGE.verification);
  });

  test("blocks delivery until mechanical check passes", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.planning);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.verification);
    await assert.rejects(
      () => transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.delivery),
      /check:mechanical|persisted check/,
    );
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.passed, "mechanical checks passed", CHECK_POLICY.blocking, checkAnchors("mechanical", "mechanical checks passed"));
    const run = await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.delivery);
    assert.equal(run.stage_id, WORKFLOW_STAGE.delivery);
  });

  test("allows verification back to execution only on failed blocking check", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.planning);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.verification);
    await assert.rejects(
      () => transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution),
      /failed persisted verification check/,
    );
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.failed, "mechanical checks failed", CHECK_POLICY.blocking, checkAnchors("mechanical", "mechanical checks failed"));
    const run = await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    assert.equal(run.stage_id, WORKFLOW_STAGE.execution);
    assert.equal(run.iteration, 2);
  });

  test("append-only task/check evidence and snapshot points to latest record", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await recordTaskResult(runtimePaths, "workflow-run:test", "task-1", "agent:specialist:software-engineer", TASK_STATUS.running, ["spec:first"], "Block", "started", taskAnchors("task-1", "started"));
    await recordTaskResult(runtimePaths, "workflow-run:test", "task-1", "agent:specialist:software-engineer", TASK_STATUS.passed, ["spec:first", "spec:second"], "Block", "done", taskAnchors("task-1", "done"));
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.failed, "fail", CHECK_POLICY.blocking, checkAnchors("mechanical", "fail"));
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.passed, "fixed", CHECK_POLICY.blocking, checkAnchors("mechanical", "fixed"));

    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    const snapshot = (await readSnapshot(runtimePaths, "workflow-run:test"))["@graph"][0];
    const journalFiles = await readdir(journalDir(runtimePaths, "workflow-run:test"));

    assert.equal(journalFiles.length, 5);
    assert.deepEqual(state.snapshot.workflow_run.task_keys, ["task-1"]);
    assert.deepEqual(state.snapshot.workflow_run.check_keys, ["check:mechanical"]);
    assert.equal(state.journal_evidence.task_records.length, 2);
    assert.equal(state.latest_projections.task_records.length, 1);
    assert.equal(state.latest_projections.task_records[0].result_status_id, TASK_STATUS.passed);
    assert.equal(state.latest_projections.check_records[0].result_status_id, CHECK_STATUS.passed);
    assert.equal(state.latest_projections.task_state_index["task-1"].record_id, state.latest_projections.task_records[0]["@id"]);
    assert.equal(state.latest_projections.check_state_index["check:mechanical"].record_id, state.latest_projections.check_records[0]["@id"]);
    assert.equal(snapshot.journal_state.last_record_id, state.latest_projections.check_records[0]["@id"]);
    assert.deepEqual(
      state.latest_projections.task_records[0].evidence_anchors.map((anchor) => anchor.anchor_kind_id).sort(),
      [EVIDENCE_ANCHOR_KIND.journalRecord, EVIDENCE_ANCHOR_KIND.toolInvocation, EVIDENCE_ANCHOR_KIND.workflowField].sort(),
    );
    assert.deepEqual(
      state.latest_projections.check_records[0].evidence_anchors.map((anchor) => anchor.anchor_kind_id).sort(),
      [EVIDENCE_ANCHOR_KIND.journalRecord, EVIDENCE_ANCHOR_KIND.toolInvocation, EVIDENCE_ANCHOR_KIND.workflowField].sort(),
    );
  });

  test("workflow-native escalation can transition planning to needs-human", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.planning);
    const run = await escalateWorkflowNeedHuman(runtimePaths, runtime, "workflow-run:test", {
      reason: "missing-context",
      detail: "authoritative planning context missing",
      source_tool_name: "read",
      evidence_anchors: checkAnchors("planning-escalation", "authoritative planning context missing"),
    });
    assert.equal(run.stage_id, WORKFLOW_STAGE.needsHuman);
    assert.equal(run.status_id, "workflow-status:blocked");
  });

  test("verification retry no-progress cap escalates to needs-human", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.planning);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.verification);
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.failed, "same failure", CHECK_POLICY.blocking, checkAnchors("mechanical", "same failure"));
    let run = await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    assert.equal(run.stage_id, WORKFLOW_STAGE.execution);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.verification);
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.failed, "same failure", CHECK_POLICY.blocking, checkAnchors("mechanical", "same failure"));
    run = await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    assert.equal(run.stage_id, WORKFLOW_STAGE.needsHuman);
    assert.equal(run.status_id, "workflow-status:blocked");
  });

  test("iteration cap escalates to needs-human", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.planning);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.verification);
    for (let index = 0; index < 2; index += 1) {
      await recordTaskResult(runtimePaths, "workflow-run:test", `progress-${index}`, "agent:specialist:software-engineer", TASK_STATUS.passed, [`spec:progress-${index}`], `block-${index}`, `progress ${index}`, taskAnchors(`progress-${index}`, `progress ${index}`));
      await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.failed, `failure ${index}`, CHECK_POLICY.blocking, checkAnchors("mechanical", `failure ${index}`));
      await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
      await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.verification);
    }
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.failed, "failure final", CHECK_POLICY.blocking, checkAnchors("mechanical", "failure final"));
    const run = await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    assert.equal(run.stage_id, WORKFLOW_STAGE.needsHuman);
    assert.equal(run.iteration, 3);
  });

  test("fails closed when old top-level single-file workflow artifact exists on read", async () => {
    const invalidTopLevelFile = join(runtimePaths.workflowsDir, "workflow-run_legacy.jsonld");
    await mkdir(runtimePaths.workflowsDir, { recursive: true });
    await writeFile(
      invalidTopLevelFile,
      JSON.stringify({
        "@graph": [
          {
            "@id": "workflow-run:legacy",
            "@type": ENTITY_TYPES.WorkflowRun,
          },
        ],
      }, null, 2),
      "utf8",
    );

    await assert.rejects(
      () => getWorkflowState(runtimePaths, "workflow-run:legacy"),
      /Strict workflow persistence format required.*single-file workflow artifact unsupported/,
    );
    assert.equal(await stat(invalidTopLevelFile).then(() => true), true);
  });

  test("fails closed on sequence gap", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await recordTaskResult(runtimePaths, "workflow-run:test", "task-1", "agent:specialist:software-engineer", TASK_STATUS.running, [], undefined, "started", taskAnchors("task-1", "started"));
    const files = (await readdir(journalDir(runtimePaths, "workflow-run:test"))).sort();
    await rm(join(journalDir(runtimePaths, "workflow-run:test"), files[0]));
    await assert.rejects(() => getWorkflowState(runtimePaths, "workflow-run:test"), /sequence gap|missing journal evidence/);
  });

  test("fails closed on snapshot latest record pointing missing record", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    const snapshot = await readSnapshot(runtimePaths, "workflow-run:test");
    snapshot["@graph"][0].journal_state.last_record_id = "workflow-transition-record:workflow-run_test:999";
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(snapshotPath(runtimePaths, "workflow-run:test"), JSON.stringify(snapshot, null, 2), "utf8");
    await assert.rejects(() => getWorkflowState(runtimePaths, "workflow-run:test"), /latest record mismatch|missing latest journal record/);
  });

  test("recovers when journal ahead of snapshot", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await recordTaskResult(runtimePaths, "workflow-run:test", "task-1", "agent:specialist:software-engineer", TASK_STATUS.running, [], undefined, "started", taskAnchors("task-1", "started"));
    const snapshot = await readSnapshot(runtimePaths, "workflow-run:test");
    snapshot["@graph"][0].journal_state.last_applied_sequence = 1;
    snapshot["@graph"][0].journal_state.last_record_id = "workflow-transition-record:workflow-run_test:1";
    snapshot["@graph"][0].task_keys = [];
    snapshot["@graph"][0].task_state_index = {};
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(snapshotPath(runtimePaths, "workflow-run:test"), JSON.stringify(snapshot, null, 2), "utf8");

    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(state.snapshot.workflow_run.task_state_index["task-1"].result_status_id, TASK_STATUS.running);
    const repaired = await readSnapshot(runtimePaths, "workflow-run:test");
    assert.equal(repaired["@graph"][0].journal_state.last_applied_sequence, 2);
  });

  test("workflow snapshot cache invalidates after external file change", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    const current = await readSnapshot(runtimePaths, "workflow-run:test");
    current["@graph"][0].stage_id = WORKFLOW_STAGE.planning;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(snapshotPath(runtimePaths, "workflow-run:test"), JSON.stringify(current, null, 2), "utf8");
    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(state.snapshot.workflow_run.stage_id, WORKFLOW_STAGE.planning);
  });

  test("workflow state labels snapshot authority, journal evidence, latest projections", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await recordTaskResult(runtimePaths, "workflow-run:test", "task-1", "agent:specialist:software-engineer", TASK_STATUS.running, [], undefined, "started", taskAnchors("task-1", "started"));
    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(state.snapshot.authority, "authoritative-snapshot");
    assert.equal(state.journal_evidence.authority, "append-only-evidence");
    assert.equal(state.latest_projections.authority, "latest-only-projection");
    assert.equal(state.bounded_cognition.authority, "authoritative-snapshot-derived");
    assert.equal(state.journal_evidence.task_records.length, 1);
    assert.equal(state.latest_projections.task_records.length, 1);
    assert.match(state.projection.provenance.snapshot_file, /snapshot\.jsonld$/);
  });

  test("fails closed when durable task/check record missing evidence anchors", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await assert.rejects(
      () => recordTaskResult(runtimePaths, "workflow-run:test", "task-no-anchor", "agent:specialist:software-engineer", TASK_STATUS.passed, [], undefined, "done"),
      /requires evidence_anchors/,
    );
    await assert.rejects(
      () => recordCheckResult(runtimePaths, "workflow-run:test", "check:no-anchor", CHECK_STATUS.passed, "done", CHECK_POLICY.blocking),
      /requires evidence_anchors/,
    );
  });

  test("fails closed when durable task/check record uses invalid evidence anchor kind", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await assert.rejects(
      () => recordTaskResult(runtimePaths, "workflow-run:test", "task-bad-anchor", "agent:specialist:software-engineer", TASK_STATUS.passed, [], undefined, "done", [{
        anchor_kind_id: "evidence-anchor-kind:unknown",
        anchor_target: "task:bad",
        anchor_label: "bad",
      }]),
      /missing anchor_kind_id/,
    );
    await assert.rejects(
      () => recordCheckResult(runtimePaths, "workflow-run:test", "check:bad-anchor", CHECK_STATUS.passed, "done", CHECK_POLICY.blocking, [{
        anchor_kind_id: EVIDENCE_ANCHOR_KIND.workflowField,
        anchor_target: "workflow-run:test#wrong.path",
        anchor_label: "bad field",
      }]),
      /requires field_path/,
    );
  });

  test("workflow directory listing fails closed when old top-level workflow artifact exists", async () => {
    let runs = await listWorkflowRuns(runtimePaths);
    assert.equal(runs.length, 0);
    await createWorkflowRun(runtimePaths, "workflow-run:first");
    runs = await listWorkflowRuns(runtimePaths);
    assert.equal(runs.length, 1);

    const invalidTopLevelFile = join(runtimePaths.workflowsDir, "workflow-run_second.jsonld");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(
      invalidTopLevelFile,
      JSON.stringify({
        "@graph": [
          {
            "@id": "workflow-run:second",
            "@type": ENTITY_TYPES.WorkflowRun,
          },
        ],
      }, null, 2),
      "utf8",
    );

    await assert.rejects(
      () => listWorkflowRuns(runtimePaths),
      /Strict workflow persistence format required.*workflow-run_second\.jsonld/,
    );
  });

  test("create workflow fails closed when old top-level workflow artifact exists", async () => {
    await mkdir(runtimePaths.workflowsDir, { recursive: true });
    await writeFile(join(runtimePaths.workflowsDir, "workflow-run_blocked.jsonld"), "{}", "utf8");

    await assert.rejects(
      () => createWorkflowRun(runtimePaths, "workflow-run:new"),
      /Strict workflow persistence format required.*workflow-run_blocked\.jsonld/,
    );
  });
});
