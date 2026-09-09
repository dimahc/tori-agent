import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CHECK_POLICY,
  CHECK_STATUS,
  ENTITY_TYPES,
  ONTOLOGY_CONTEXT_IRI,
  TASK_STATUS,
  WELL_KNOWN_IDS,
  WORKFLOW_STAGE,
  WORKFLOW_STATUS,
  buildRuntimePaths,
} from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";
import {
  createWorkflowRun,
  getWorkflowState,
  listWorkflowRuns,
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

  test("verification retry no-progress cap escalates to needs-human", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.planning);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.verification);
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.failed, "same failure", CHECK_POLICY.blocking);
    let run = await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    assert.equal(run.stage_id, WORKFLOW_STAGE.execution);
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.verification);
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.failed, "same failure", CHECK_POLICY.blocking);
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
      await recordTaskResult(runtimePaths, "workflow-run:test", `progress-${index}`, "agent:specialist:software-engineer", TASK_STATUS.passed, [`spec:progress-${index}`], `block-${index}`, `progress ${index}`);
      await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.failed, `failure ${index}`, CHECK_POLICY.blocking);
      await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
      await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.verification);
    }
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.failed, "failure final", CHECK_POLICY.blocking);
    const run = await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.execution);
    assert.equal(run.stage_id, WORKFLOW_STAGE.needsHuman);
    assert.equal(run.iteration, 3);
  });

  test("records task and check records by ontology ids", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await recordTaskResult(runtimePaths, "workflow-run:test", "task-1", "agent:specialist:software-engineer", TASK_STATUS.running, ["spec:test"], "Implement block", "started");
    await recordCheckResult(runtimePaths, "workflow-run:test", "check:mechanical", CHECK_STATUS.passed, "all good", CHECK_POLICY.blocking);
    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(state.task_records[0].requesting_agent_id, "agent:specialist:software-engineer");
    assert.equal(state.check_records[0].result_status_id, CHECK_STATUS.passed);
    assert.equal(state.workflow_run.check_record_index["check:mechanical"].check_policy_id, CHECK_POLICY.blocking);
    assert.equal(state.workflow_run.task_record_index["workflow-task:workflow-run_test:task-1"].requesting_agent_id, "agent:specialist:software-engineer");
  });

  test("workflow document cache invalidates after external file change", async () => {
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    const file = join(runtimePaths.workflowsDir, "workflow-run_test.jsonld");
    const current = JSON.parse(await readFile(file, "utf8"));
    current["@graph"][0].stage_id = WORKFLOW_STAGE.planning;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(file, JSON.stringify(current, null, 2), "utf8");
    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(state.workflow_run.stage_id, WORKFLOW_STAGE.planning);
  });

  test("workflow directory cache invalidates after external file add and rewrite", async () => {
    let runs = await listWorkflowRuns(runtimePaths);
    assert.equal(runs.length, 0);
    await createWorkflowRun(runtimePaths, "workflow-run:first");
    runs = await listWorkflowRuns(runtimePaths);
    assert.equal(runs.length, 1);

    const secondFile = join(runtimePaths.workflowsDir, "workflow-run_second.jsonld");
    const now = "2026-09-09T00:00:00.000Z";
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(
      secondFile,
      JSON.stringify({
        "@context": ONTOLOGY_CONTEXT_IRI,
        "@graph": [
          {
            "@id": "workflow-run:second",
            "@type": ENTITY_TYPES.WorkflowRun,
            label: "workflow-run:second",
            description: "Workflow run workflow-run:second",
            definition_id: WELL_KNOWN_IDS.orchestrationWorkflow,
            stage_id: WORKFLOW_STAGE.execution,
            status_id: WORKFLOW_STATUS.active,
            iteration: 1,
            task_record_ids: [],
            check_record_ids: [],
            check_status_index: {},
            check_record_index: {},
            task_record_index: {},
            related_artifact_ids: [],
            created_at: now,
            updated_at: now,
            loop_state: {
              transition_counts: {},
              retry_counts: {},
              no_progress_counts: {},
              progress_signatures: {},
              failure_signatures: {},
              identical_failure_counts: {},
            },
            history: [{ from_stage_id: null, to_stage_id: WORKFLOW_STAGE.execution, occurred_at: now }],
          },
        ],
      }, null, 2),
      "utf8",
    );
    runs = await listWorkflowRuns(runtimePaths);
    assert.equal(runs.length, 2);
    assert.ok(runs.some((run) => run["@id"] === "workflow-run:second"));

    const second = JSON.parse(await readFile(secondFile, "utf8"));
    second["@graph"][0].stage_id = WORKFLOW_STAGE.verification;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(secondFile, JSON.stringify(second, null, 2), "utf8");
    runs = await listWorkflowRuns(runtimePaths);
    assert.equal(runs.find((run) => run["@id"] === "workflow-run:second")?.stage_id, WORKFLOW_STAGE.verification);
  });
});
