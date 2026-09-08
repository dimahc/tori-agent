import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CHECK_POLICY,
  CHECK_STATUS,
  TASK_STATUS,
  WORKFLOW_STAGE,
  buildRuntimePaths,
} from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";
import {
  createWorkflowRun,
  getWorkflowState,
  recordCheckResult,
  recordTaskResult,
  transitionStage,
} from "../dist/tools/workflow.js";

describe("workflow strict ontology", () => {
  let root;
  let runtimePaths;
  let runtime;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tori-workflow-"));
    runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    runtime = await initializeOntologyRuntime();
  });

  test("creates ontology-native workflow run", async () => {
    const run = await createWorkflowRun(runtimePaths, "workflow-run:test");
    assert.equal(run.stage_id, WORKFLOW_STAGE.requirements);
    const stored = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(stored.workflow_run["@id"], "workflow-run:test");
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
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.passed, "mechanical checks passed", CHECK_POLICY.blocking);
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
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.failed, "mechanical checks failed", CHECK_POLICY.blocking);
    const run = await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    assert.equal(run.stage_id, WORKFLOW_STAGE.execution);
    assert.equal(run.iteration, 2);
  });

  test("records task and check records by ontology ids", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await recordTaskResult(runtimePaths, "workflow-run:test", "task-1", "agent:specialist:software-engineer", TASK_STATUS.running, ["spec:test"], "Implement block", "started");
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.passed, "all good", CHECK_POLICY.blocking);
    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(state.task_records[0].requesting_agent_id, "agent:specialist:software-engineer");
    assert.equal(state.check_records[0].result_status_id, CHECK_STATUS.passed);
    assert.equal(state.workflow_run.check_record_index["check:mechanical"].check_policy_id, CHECK_POLICY.blocking);
  });
});
