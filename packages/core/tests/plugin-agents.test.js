import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CHECK_STATUS, WORKFLOW_STAGE, buildRuntimePaths } from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";
import { createWorkflowRun, getWorkflowState, transitionStage } from "../dist/tools/workflow.js";
import {
  deriveNativeMutationAuthorizationPattern,
  deriveSessionTitle,
  isDefaultSessionTitle,
  buildReadOnlyTools,
  buildWriteTools,
  createAuthorizedToolExecutor,
  createBudgetAwareToolExecutor,
  ensureToolRegistryRegistered,
  isNativeMutationTool,
} from "../dist/index.js";
import { buildPlugin } from "../../harness/dist/plugin.js";

describe("plugin ontology integration", () => {
  test("runtime builds host agent configs from ontology", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-runtime-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const configs = await runtime.buildRuntimeAgentConfigs("opencode");
    assert.ok(configs.tori);
    assert.equal(configs.tori.permission.transition_stage, "allow");
    assert.equal(configs.tori.tools.transition_stage, true);
    assert.equal(configs.tori.tools.write, undefined);
    assert.equal(configs.tori.tools.structured_read, undefined);
    assert.equal(configs.tori.tools.run_mechanical_checks, undefined);
    assert.equal(configs.tori.tools.trigger_ci_check, undefined);
    assert.equal(configs.tori.tools.save_checkpoint, undefined);
    assert.equal(configs.tori.tools.scratchpad, undefined);
    assert.ok(configs["specialist:software-engineer"]);
    assert.equal(configs["specialist:software-engineer"].tools.structured_read, true);
  });

  test("runtime permission map does not synthesize write/edit symmetry", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-permission-shape-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const configs = await runtime.buildRuntimeAgentConfigs("opencode");
    assert.equal(configs.tori.permission.write, undefined);
    assert.equal(configs.tori.permission.edit, undefined);
  });

  test("runtime resolves default main-session agent as tori", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-default-agent-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    assert.deepEqual(runtime.getDefaultMainSessionAgent("opencode"), {
      agentId: "agent:tori",
      hostAgentName: "tori",
    });
  });

  test("tool builders expose ontology-native tool set", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const readOnly = buildReadOnlyTools(root, runtimePaths);
    const write = buildWriteTools(root, runtimePaths, "opencode");
    assert.ok(readOnly.workflow_state);
    assert.ok(readOnly.structured_read);
    assert.ok(write.transition_stage);
    assert.ok(write.record_check_result);
    assert.ok(write.trigger_ci_check);
  });

  test("workflow_state requires workflow_run_id and accepts strict legacy alias only when not conflicting", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-workflow-state-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    const readOnly = buildReadOnlyTools(root, runtimePaths);

    assert.deepEqual(readOnly.workflow_state.args, { workflow_run_id: {} });
    assert.deepEqual(JSON.parse(await readOnly.workflow_state.execute({})), { error: "workflow_run_id required" });
    assert.equal(JSON.parse(await readOnly.workflow_state.execute({ workflow_id: "workflow-run:test" })).snapshot.workflow_run["@id"], "workflow-run:test");
    assert.deepEqual(
      JSON.parse(await readOnly.workflow_state.execute({ workflow_run_id: "workflow-run:test", workflow_id: "workflow-run:other" })),
      { error: "workflow_run_id conflicts with legacy workflow_id" },
    );
  });

  test("managed artifact id lookup cache invalidates when plan file changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-managed-id-cache-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    await mkdir(runtimePaths.execPlansDir, { recursive: true });
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    const tools = buildWriteTools(root, runtimePaths, "opencode");
    const planPath = join(runtimePaths.execPlansDir, "plan.md");
    await writeFile(
      planPath,
      [
        "---",
        "artifact_id: exec-plan:one",
        "artifact_type_id: artifact-type:exec-plan",
        "status_id: artifact-status:active",
        'title: "Plan"',
        "created_at: 2026-09-09T00:00:00.000Z",
        "---",
        "",
        "- [ ] Task one",
      ].join("\n"),
      "utf8",
    );
    await tools.record_task_result.execute({
      workflow_id: "workflow-run:test",
      task_id: "task-1",
      agent: "agent:specialist:software-engineer",
      status: "task-status:passed",
      plan_file: "plan.md",
    });
    let state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.ok(state.snapshot.workflow_run.related_artifact_ids.includes("exec-plan:one"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(
      planPath,
      [
        "---",
        "artifact_id: exec-plan:two",
        "artifact_type_id: artifact-type:exec-plan",
        "status_id: artifact-status:active",
        'title: "Plan"',
        "created_at: 2026-09-09T00:00:00.000Z",
        "updated_at: 2026-09-09T00:00:01.000Z",
        "---",
        "",
        "- [ ] Task one",
      ].join("\n"),
      "utf8",
    );
    await tools.record_task_result.execute({
      workflow_id: "workflow-run:test",
      task_id: "task-2",
      agent: "agent:specialist:software-engineer",
      status: "task-status:passed",
      plan_file: "plan.md",
    });
    state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.ok(state.snapshot.workflow_run.related_artifact_ids.includes("exec-plan:two"));
  });

  test("authorized tool executor blocks tori direct and surrogate mutation tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-wrap-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const wrapped = createAuthorizedToolExecutor(
      { ...buildReadOnlyTools(root, runtimePaths), ...buildWriteTools(root, runtimePaths, "opencode") },
      { ontologyRuntime: runtime, projectRoot: root, runtimePaths },
    );

    await assert.rejects(
      () => wrapped.register_spec.execute({ spec_file: "blocked.md", title: "Blocked" }, { sessionID: "s-block", directory: root, agent: "tori" }),
      /Unauthorized tool execution for register_spec/,
    );
    await assert.rejects(
      () => wrapped.run_mechanical_checks.execute({}, { sessionID: "s-block", directory: root, agent: "tori" }),
      /Unauthorized tool execution for run_mechanical_checks/,
    );
    await assert.rejects(
      () => wrapped.trigger_ci_check.execute({ workflow_id: "workflow-run:test", config: { check_id: "lint" } }, { sessionID: "s-block", directory: root, agent: "tori" }),
      /Unauthorized tool execution for trigger_ci_check/,
    );
    await assert.rejects(
      () => wrapped.save_checkpoint.execute({ file: "blocked.json", summary: "x", remaining_work: "y" }, { sessionID: "s-block", directory: root, agent: "tori" }),
      /Unauthorized tool execution for save_checkpoint/,
    );
  });

  test("authorized tool executor blocks direct unauthorized invocation without permission.ask", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-direct-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const wrapped = createAuthorizedToolExecutor(
      { ...buildReadOnlyTools(root, runtimePaths), ...buildWriteTools(root, runtimePaths, "opencode") },
      { ontologyRuntime: runtime, projectRoot: root, runtimePaths },
    );

    await assert.rejects(
      () => wrapped.register_spec.execute({ spec_file: "blocked.md", title: "Blocked" }, { sessionID: "s-direct", directory: root }),
      /Unauthorized tool execution for register_spec/,
    );
  });

  test("authorized specialist path still works", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-specialist-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const wrapped = createAuthorizedToolExecutor(
      { ...buildReadOnlyTools(root, runtimePaths), ...buildWriteTools(root, runtimePaths, "opencode") },
      { ontologyRuntime: runtime, projectRoot: root, runtimePaths },
    );

    const result = JSON.parse(await wrapped.save_checkpoint.execute(
      { file: "resume.json", summary: "sum", remaining_work: "remain" },
      { sessionID: "s-spec", directory: root, agent: "specialist:software-engineer" },
    ));
    assert.match(result.file, /resume\.json$/);
    assert.equal(result.projection.surface, "checkpoint");
  });

  test("loop guard denies repeated identical tool calls after cap", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-loop-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const tools = createBudgetAwareToolExecutor({
      skill: {
        description: "test tool",
        args: {},
        async execute() {
          return "ok";
        },
      },
    }, { ontologyRuntime: runtime });

    await tools.skill.execute({}, { sessionID: "loop-a", directory: root, agent: "tori" });
    await tools.skill.execute({}, { sessionID: "loop-a", directory: root, agent: "tori" });
    await assert.rejects(
      () => tools.skill.execute({}, { sessionID: "loop-a", directory: root, agent: "tori" }),
      /identical invocation cap 2 exceeded/,
    );
  });

  test("loop guard denies repeated identical failures after cap", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-loop-fail-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const tools = createBudgetAwareToolExecutor({
      skill: {
        description: "failing tool",
        args: {},
        async execute() {
          throw new Error("boom");
        },
      },
    }, { ontologyRuntime: runtime });

    await assert.rejects(() => tools.skill.execute({}, { sessionID: "loop-b", directory: root, agent: "tori" }), /boom/);
    await assert.rejects(() => tools.skill.execute({}, { sessionID: "loop-b", directory: root, agent: "tori" }), /boom/);
    await assert.rejects(
      () => tools.skill.execute({}, { sessionID: "loop-b", directory: root, agent: "tori" }),
      /identical invocation cap 2 exceeded|identical failure cap 2 exceeded/,
    );
  });

  test("loop guard enforces speculation cap and escalates through workflow state", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-loop-spec-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.planning);
    const tools = createBudgetAwareToolExecutor({
      question: {
        description: "question tool",
        args: {},
        async execute() {
          return "ok";
        },
      },
    }, { ontologyRuntime: runtime, runtimePaths });

    await tools.question.execute({ workflow_id: "workflow-run:test" }, { sessionID: "loop-spec", directory: root, agent: "tori" });
    await tools.question.execute({ workflow_id: "workflow-run:test" }, { sessionID: "loop-spec", directory: root, agent: "tori" });
    await assert.rejects(
      () => tools.question.execute({ workflow_id: "workflow-run:test" }, { sessionID: "loop-spec", directory: root, agent: "tori" }),
      /speculation cap 2 exceeded/,
    );
    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(state.snapshot.workflow_run.stage_id, WORKFLOW_STAGE.needsHuman);
    assert.equal(state.snapshot.workflow_run.loop_state.bounded_cognition.speculation_actions, 3);
    const escalationCheck = state.latest_projections.check_records.find((record) => record.check_key === "check:workflow-escalation:question");
    assert.equal(escalationCheck?.result_status_id, CHECK_STATUS.failed);
  });

  test("loop guard classifies read search clarification from ontology capabilities", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-loop-classify-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.planning);
    const tools = createBudgetAwareToolExecutor({
      read: { description: "read tool", args: {}, async execute() { return "ok"; } },
      glob: { description: "glob tool", args: {}, async execute() { return "ok"; } },
      question: { description: "question tool", args: {}, async execute() { return "ok"; } },
    }, { ontologyRuntime: runtime, runtimePaths });

    await tools.read.execute({ workflow_id: "workflow-run:test" }, { sessionID: "loop-classify", directory: root, agent: "tori" });
    await tools.glob.execute({ workflow_id: "workflow-run:test" }, { sessionID: "loop-classify", directory: root, agent: "tori" });
    await tools.question.execute({ workflow_id: "workflow-run:test" }, { sessionID: "loop-classify", directory: root, agent: "tori" });

    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(state.snapshot.workflow_run.loop_state.bounded_cognition.investigation_actions, 1);
    assert.equal(state.snapshot.workflow_run.loop_state.bounded_cognition.search_actions, 1);
    assert.equal(state.snapshot.workflow_run.loop_state.bounded_cognition.speculation_actions, 1);
  });

  test("reviewer loop guard trips cumulative investigation budget across varied reads", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-reviewer-investigation-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    const tools = createBudgetAwareToolExecutor({
      read: { description: "read tool", args: {}, async execute() { return "ok"; } },
    }, { ontologyRuntime: runtime, runtimePaths });

    for (let index = 0; index < 8; index += 1) {
      await tools.read.execute({ workflow_id: "workflow-run:test", filePath: `file-${index}.ts` }, { sessionID: "reviewer-investigation", directory: root, agent: "reviewer:quality" });
    }
    await assert.rejects(
      () => tools.read.execute({ workflow_id: "workflow-run:test", filePath: "file-9.ts" }, { sessionID: "reviewer-investigation", directory: root, agent: "reviewer:quality" }),
      /investigation cap 8 exceeded/,
    );
  });

  test("specialist loop guard trips cumulative search budget across varied search tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-specialist-search-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    const tools = createBudgetAwareToolExecutor({
      glob: { description: "glob tool", args: {}, async execute() { return "ok"; } },
      grep: { description: "grep tool", args: {}, async execute() { return "ok"; } },
    }, { ontologyRuntime: runtime, runtimePaths });

    for (let index = 0; index < 4; index += 1) {
      await tools.glob.execute({ workflow_id: "workflow-run:test", pattern: `src/${index}/**/*.ts` }, { sessionID: "specialist-search", directory: root, agent: "specialist:software-engineer" });
      await tools.grep.execute({ workflow_id: "workflow-run:test", pattern: `needle-${index}`, path: `src/${index}` }, { sessionID: "specialist-search", directory: root, agent: "specialist:software-engineer" });
    }
    await assert.rejects(
      () => tools.glob.execute({ workflow_id: "workflow-run:test", pattern: "src/overflow/**/*.ts" }, { sessionID: "specialist-search", directory: root, agent: "specialist:software-engineer" }),
      /search cap 8 exceeded/,
    );
  });

  test("workflow persisted bounded cognition blocks fresh session evasion", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-persisted-loop-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    const tools = createBudgetAwareToolExecutor({
      glob: { description: "glob tool", args: {}, async execute() { return "ok"; } },
    }, { ontologyRuntime: runtime, runtimePaths });

    for (let index = 0; index < 6; index += 1) {
      await tools.glob.execute({ workflow_id: "workflow-run:test", pattern: `pkg/${index}/**/*` }, { sessionID: "reviewer-session-a", directory: root, agent: "reviewer:quality" });
    }
    await assert.rejects(
      () => tools.glob.execute({ workflow_id: "workflow-run:test", pattern: "pkg/overflow/**/*" }, { sessionID: "reviewer-session-b", directory: root, agent: "reviewer:quality" }),
      /search cap 6 exceeded/,
    );

    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(state.snapshot.workflow_run.stage_id, WORKFLOW_STAGE.needsHuman);
    assert.equal(state.snapshot.workflow_run.loop_state.bounded_cognition.search_actions, 7);
  });

  test("readonly bash inspection counts against search budget through native hook", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-native-bash-budget-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-review-native-bash", agent: "reviewer:quality" }, {});
    for (let index = 0; index < 6; index += 1) {
      await plugin["tool.execute.before"](
        { tool: "bash", sessionID: "s-review-native-bash", callID: String(index) },
        { args: { command: `rg --files packages/${index}`, workflow_id: "workflow-run:test" } },
      );
    }
    await assert.rejects(
      () => plugin["tool.execute.before"](
        { tool: "bash", sessionID: "s-review-native-bash", callID: "overflow" },
        { args: { command: "rg --files packages/overflow", workflow_id: "workflow-run:test" } },
      ),
      /search cap 6 exceeded/,
    );

    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(state.snapshot.workflow_run.stage_id, WORKFLOW_STAGE.needsHuman);
    assert.equal(state.snapshot.workflow_run.loop_state.bounded_cognition.search_actions, 7);
  });

  test("loop guard records missing bound agent as workflow-native escalation when workflow_id exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-loop-missing-agent-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    await createWorkflowRun(runtimePaths, "workflow-run:test");
    await transitionStage(runtimePaths, runtime, "workflow-run:test", WORKFLOW_STAGE.planning);
    const tools = createBudgetAwareToolExecutor({
      read: {
        description: "read tool",
        args: {},
        async execute() {
          return "ok";
        },
      },
    }, { ontologyRuntime: runtime, runtimePaths });

    await assert.rejects(
      () => tools.read.execute({ workflow_id: "workflow-run:test" }, { sessionID: "loop-missing-agent", directory: root }),
      /missing bound agent/,
    );
    const state = await getWorkflowState(runtimePaths, "workflow-run:test");
    assert.equal(state.snapshot.workflow_run.stage_id, WORKFLOW_STAGE.needsHuman);
    assert.equal(state.snapshot.workflow_run.loop_state.bounded_cognition.missing_context_failures, 1);
  });

  test("session authorization binds to actual tracked agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-auth-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    runtime.bindSession("s1", "tori");
    runtime.bindSession("s2", "specialist:software-engineer");
    const toriWrite = runtime.authorizeSession("s1", "write", "README.md", runtimePaths);
    const engineerWrite = runtime.authorizeSession("s2", "write", "README.md", runtimePaths);
    assert.equal(toriWrite.effect, "deny");
    assert.equal(engineerWrite.effect, "allow");
  });

  test("title helpers derive concise stable title and detect placeholders", async () => {
    assert.equal(
      deriveSessionTitle("  Fix session naming to use first user request instead of timestamp fallback.  "),
      "Fix session naming to use first user request instead of timestamp fallback",
    );
    assert.equal(isDefaultSessionTitle("Untitled Session"), true);
    assert.equal(isDefaultSessionTitle("Fix session naming"), false);
  });

  test("chat.message binds session when official input.agent present", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-title-auth-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    const output = {};
    await plugin["chat.message"]({ sessionID: "s-auth", agent: "specialist:software-engineer" }, output);
    assert.deepEqual(output, {});

    const permission = { status: "ask" };
    await plugin["permission.ask"]({ sessionID: "s-auth", permission: "write", patterns: ["README.md"] }, permission);
    assert.equal(permission.status, "allow");
  });

  test("event reads session.created sessionID from event.properties.sessionID and does safe bootstrap only", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-session-created-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-created", agent: "specialist:software-engineer" }, {});
    await plugin.event({ event: { type: "session.created", properties: { sessionID: "s-created" } } });

    assert.ok((await readdir(runtimePaths.runtimeRoot)).includes("workflows"));

    const permission = { status: "ask" };
    await plugin["permission.ask"]({ sessionID: "s-created", permission: "write", patterns: ["README.md"] }, permission);
    assert.equal(permission.status, "deny");
  });

  test("event binds session from official session.created info.agent surface", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-session-created-agent-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    const permissionBefore = { status: "ask" };
    await plugin["permission.ask"]({ sessionID: "s-created-agent", permission: "write", patterns: ["README.md"] }, permissionBefore);
    assert.equal(permissionBefore.status, "deny");

    await plugin.event({ event: { type: "session.created", properties: { sessionID: "s-created-agent", info: { agent: "specialist:software-engineer" } } } });

    const permissionAfter = { status: "ask" };
    await plugin["permission.ask"]({ sessionID: "s-created-agent", permission: "write", patterns: ["README.md"] }, permissionAfter);
    assert.equal(permissionAfter.status, "allow");
  });

  test("event updates binding from official session.updated info.agent surface", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-session-updated-agent-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-updated-agent", agent: "tori" }, {});
    let permission = { status: "ask" };
    await plugin["permission.ask"]({ sessionID: "s-updated-agent", permission: "write", patterns: ["README.md"] }, permission);
    assert.equal(permission.status, "deny");

    await plugin.event({ event: { type: "session.updated", properties: { sessionID: "s-updated-agent", info: { agent: "specialist:software-engineer" } } } });

    permission = { status: "ask" };
    await plugin["permission.ask"]({ sessionID: "s-updated-agent", permission: "write", patterns: ["README.md"] }, permission);
    assert.equal(permission.status, "allow");
  });

  test("event updates binding from official session.next.agent.switched surface", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-agent-switched-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin.event({ event: { type: "session.next.agent.switched", properties: { sessionID: "s-switch", agent: "specialist:software-engineer" } } });

    const permission = { status: "ask" };
    await plugin["permission.ask"]({ sessionID: "s-switch", permission: "write", patterns: ["README.md"] }, permission);
    assert.equal(permission.status, "allow");
  });

  test("permission.ask accepts official payload shape and denies tori native mutation permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-unbound-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-tori", agent: "tori" }, {});

    const permission = { status: "ask" };
    await plugin["permission.ask"]({
      id: "perm-1",
      sessionID: "s-tori",
      permission: "write",
      patterns: ["README.md"],
      metadata: { source: "test" },
      always: ["session"],
      tool: { name: "write" },
    }, permission);
    assert.equal(permission.status, "deny");
  });

  test("permission.ask preserves existing output for non-ontology permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-unbound-read-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    const permission = { status: "ask" };
    await plugin["permission.ask"]({ sessionID: "s-unbound-read", permission: "clipboard.write" }, permission);
    assert.equal(permission.status, "ask");
  });

  test("unknown host agent binding stays denied and does not fall back to tori", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-unknown-agent-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-unknown", agent: "host-private-agent" }, {});

    const permission = { status: "ask" };
    await plugin["permission.ask"]({ sessionID: "s-unknown", permission: "read", patterns: ["README.md"] }, permission);
    assert.equal(permission.status, "deny");
  });

  test("tool.execute.before blocks native write edit bash for tori", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-native-block-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-native-block", agent: "tori" }, {});

    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "write", sessionID: "s-native-block", callID: "1" }, { args: { filePath: "README.md" } }),
      /Unauthorized native tool execution for write/,
    );
    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "edit", sessionID: "s-native-block", callID: "2" }, { args: { filePath: "README.md" } }),
      /Unauthorized native tool execution for edit/,
    );
    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "bash", sessionID: "s-native-block", callID: "3" }, { args: { command: "npm test" } }),
      /Unauthorized native tool execution for bash/,
    );
  });

  test("tool.execute.before allows native mutation tools for specialist where ontology allows", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-native-allow-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-native-allow", agent: "specialist:software-engineer" }, {});
    await plugin["tool.execute.before"]({ tool: "write", sessionID: "s-native-allow", callID: "1" }, { args: { filePath: "README.md" } });
    await plugin["tool.execute.before"]({ tool: "edit", sessionID: "s-native-allow", callID: "2" }, { args: { filePath: "README.md" } });
    await plugin["tool.execute.before"]({ tool: "bash", sessionID: "s-native-allow", callID: "3" }, { args: { command: "npm test" } });
  });

  test("tool.execute.before allows expanded readonly bash grants for specialists and reviewers only", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-bash-allowlist-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-spec-bash", agent: "specialist:software-engineer" }, {});
    await plugin["tool.execute.before"]({ tool: "bash", sessionID: "s-spec-bash", callID: "1" }, { args: { command: "pwd" } });
    await plugin["tool.execute.before"]({ tool: "bash", sessionID: "s-spec-bash", callID: "2" }, { args: { command: "git status --short" } });
    await plugin["tool.execute.before"]({ tool: "bash", sessionID: "s-spec-bash", callID: "3" }, { args: { command: "git log --oneline -10" } });
    await plugin["tool.execute.before"]({ tool: "bash", sessionID: "s-spec-bash", callID: "4" }, { args: { command: "rg --files packages/core" } });
    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "bash", sessionID: "s-spec-bash", callID: "5" }, { args: { command: "git add README.md" } }),
      /Unauthorized native tool execution for bash/,
    );

    await plugin["chat.message"]({ sessionID: "s-review-bash", agent: "reviewer:quality" }, {});
    await plugin["tool.execute.before"]({ tool: "bash", sessionID: "s-review-bash", callID: "6" }, { args: { command: "pwd" } });
    await plugin["tool.execute.before"]({ tool: "bash", sessionID: "s-review-bash", callID: "7" }, { args: { command: "rg --files packages/core/tests" } });

    await plugin["chat.message"]({ sessionID: "s-tori-bash", agent: "tori" }, {});
    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "bash", sessionID: "s-tori-bash", callID: "8" }, { args: { command: "pwd" } }),
      /Unauthorized native tool execution for bash/,
    );
  });

  test("experimental.text.complete rewrites repetitive self-talk output text in place", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-output-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-out", agent: "tori" }, {});

    const output = { text: "Let me think through this.\n\nResult ready.\n\nResult ready." };
    await plugin["experimental.text.complete"]({ sessionID: "s-out", messageID: "m1", partID: "p1" }, output);

    assert.equal(output.text, "Result ready.");
  });

  test("config mutates object in place and sets default_agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-merge-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });
    const config = {
      hostPrivate: { picker: { enabled: true } },
      agent: {
        tori: {
          label: "Host Tori Label",
          prompt: "host override",
          metadata: { hostPicker: "keep-me" },
          tools: { write: true },
          permission: { write: "allow" },
        },
        rogue: {
          prompt: "rogue",
          hostPrivate: true,
        },
      },
      session: {
        hostSessionField: true,
      },
      ontology: {
        hostOntologyField: true,
      },
    };
    const originalRef = config;

    await plugin.config(config);

    assert.equal(config, originalRef);
    assert.equal(config.hostPrivate.picker.enabled, true);
    assert.equal(config.agent.tori.label, "Host Tori Label");
    assert.equal(config.agent.tori.metadata.hostPicker, "keep-me");
    assert.notEqual(config.agent.tori.prompt, "host override");
    assert.equal(config.agent.tori.tools.write, undefined);
    assert.equal(config.agent.tori.permission.write, undefined);
    assert.equal(config.agent.rogue.prompt, "rogue");
    assert.equal(config.agent.rogue.hostPrivate, true);
    assert.equal(config.default_agent, "tori");
    assert.deepEqual(config.session, {
      hostSessionField: true,
      default_agent: "tori",
      default_agent_id: "agent:tori",
      authoritative: true,
      source: "ontology",
    });
    assert.equal(config.ontology.authoritative, true);
    assert.equal(config.ontology.hostOntologyField, true);
    assert.ok(config.ontology.authoritative_agent_keys.includes("tori"));
  });

  test("runtime initialize one-flight returns same instance under concurrent first use", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-init-once-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const [first, second] = await Promise.all([
      initializeOntologyRuntime({ runtimePaths }),
      initializeOntologyRuntime({ runtimePaths }),
    ]);
    assert.equal(first, second);
    assert.deepEqual(first.getDefaultMainSessionAgent("opencode"), second.getDefaultMainSessionAgent("opencode"));
  });

  test("runtime agent configs are stable across repeated calls and not aliased", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-config-cache-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const first = await runtime.buildRuntimeAgentConfigs("opencode");
    first.tori.tools.read = false;
    first.tori.permission.read = "deny";
    const second = await runtime.buildRuntimeAgentConfigs("opencode");
    assert.equal(second.tori.tools.read, true);
    assert.equal(second.tori.permission.read, "allow");
    assert.notEqual(first, second);
    assert.notEqual(first.tori, second.tori);
  });

  test("tool registry registration helper avoids rewrapping side effects", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-register-cache-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const tools = createAuthorizedToolExecutor(
      createBudgetAwareToolExecutor({ ...buildReadOnlyTools(root, runtimePaths), ...buildWriteTools(root, runtimePaths, "opencode") }, { ontologyRuntime: runtime }),
      { ontologyRuntime: runtime, projectRoot: root, runtimePaths },
    );
    ensureToolRegistryRegistered(tools);
    ensureToolRegistryRegistered(tools);
    const list = JSON.parse(await buildReadOnlyTools(root, runtimePaths).list_available_tools.execute({}));
    const names = list.tools.map((tool) => tool.name);
    assert.equal(names.length, new Set(names).size);
  });

  test("plugin factory reuses setup for same runtime context", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-setup-cache-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const first = await factory({ directory: root, worktree: root });
    const second = await factory({ directory: root, worktree: root });
    assert.equal(first.tool, second.tool);
    assert.equal(first.config, second.config);
    assert.equal(first["permission.ask"], second["permission.ask"]);
  });

  test("native tool helper derives authorization patterns from official args", async () => {
    assert.equal(isNativeMutationTool("write"), true);
    assert.equal(isNativeMutationTool("tool.edit"), true);
    assert.equal(isNativeMutationTool("read"), false);
    assert.equal(deriveNativeMutationAuthorizationPattern("write", { filePath: "README.md" }), "README.md");
    assert.equal(deriveNativeMutationAuthorizationPattern("edit", { file: "README.md" }), "README.md");
    assert.equal(deriveNativeMutationAuthorizationPattern("bash", { command: "npm test" }), "npm test");
  });

  test("native glob pattern derivation combines path and pattern for deny matching", async () => {
    assert.equal(deriveNativeMutationAuthorizationPattern("glob", { pattern: ".env" }), ".env");
    assert.equal(deriveNativeMutationAuthorizationPattern("glob", { pattern: "**/.env" }), "**/.env");
    assert.equal(deriveNativeMutationAuthorizationPattern("glob", { pattern: "*.ts", path: ".env" }), ".env/*.ts");
    assert.equal(deriveNativeMutationAuthorizationPattern("glob", { pattern: "**/*", path: "src" }), "src/**/*");
    assert.equal(deriveNativeMutationAuthorizationPattern("glob", { pattern: "**/*" }), "**/*");
  });

  test("native grep pattern derivation combines path and include for deny matching", async () => {
    assert.equal(deriveNativeMutationAuthorizationPattern("grep", { path: ".env" }), ".env");
    assert.equal(deriveNativeMutationAuthorizationPattern("grep", { path: "src", include: "*.ts" }), "src/*.ts");
    assert.equal(deriveNativeMutationAuthorizationPattern("grep", { include: ".env" }), ".env");
    assert.equal(deriveNativeMutationAuthorizationPattern("grep", {}), undefined);
  });

  test("tool.execute.before denies native glob targeting env files via full plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-native-glob-deny-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-glob-deny", agent: "specialist:software-engineer" }, {});

    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "glob", sessionID: "s-glob-deny", callID: "1" }, { args: { pattern: ".env" } }),
      /Unauthorized native tool execution for glob/,
    );
    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "glob", sessionID: "s-glob-deny", callID: "2" }, { args: { pattern: "**/.env" } }),
      /Unauthorized native tool execution for glob/,
    );
    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "glob", sessionID: "s-glob-deny", callID: "3" }, { args: { pattern: ".env.json" } }),
      /Unauthorized native tool execution for glob/,
    );
    await plugin["tool.execute.before"]({ tool: "glob", sessionID: "s-glob-deny", callID: "4" }, { args: { pattern: "**/*.ts", path: "src" } });
  });

  test("tool.execute.before denies native grep targeting env files via full plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-native-grep-deny-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-grep-deny", agent: "specialist:software-engineer" }, {});

    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "grep", sessionID: "s-grep-deny", callID: "1" }, { args: { path: ".env" } }),
      /Unauthorized native tool execution for grep/,
    );
    await assert.rejects(
      () => plugin["tool.execute.before"]({ tool: "grep", sessionID: "s-grep-deny", callID: "2" }, { args: { include: ".env" } }),
      /Unauthorized native tool execution for grep/,
    );
    await plugin["tool.execute.before"]({ tool: "grep", sessionID: "s-grep-deny", callID: "3" }, { args: { path: "src", include: "*.ts" } });
  });

  test("fresh project with no local ontology still loads builtin tori", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-fresh-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const tori = runtime.getRegistry().getAgent("agent:tori");
    assert.ok(tori);
    assert.equal(tori.label, "Tori");
  });

  test("local ontology override cannot relax builtin tori safety policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-override-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    await mkdir(runtimePaths.ontologyDir, { recursive: true });
    await mkdir(join(runtimePaths.ontologyDir, "prompts"), { recursive: true });
    await writeFile(join(runtimePaths.ontologyDir, "override.jsonld"), JSON.stringify({
      "@context": "https://tori-agent.dev/ontology/2026/core/context",
      "@graph": [
        {
          "@id": "agent:tori",
          "@type": "Agent",
          "label": "Tori Override",
          "description": "Project-local Tori override attempt",
          "role_ids": ["role:orchestrator"],
          "capability_ids": [
            "capability:orchestration",
            "capability:workflow-governance",
            "capability:verification",
            "capability:artifact-observation",
            "capability:checkpointing"
          ],
          "tool_ids": [
            "tool:task",
            "tool:read",
            "tool:project_state",
            "tool:workflow_state",
            "tool:transition_stage",
            "tool:record_task_result",
            "tool:record_check_result",
            "tool:check_artifacts",
            "tool:write_append",
            "tool:trigger_ci_check",
            "tool:save_checkpoint",
            "tool:scratchpad",
            "tool:skill",
            "tool:question"
          ],
          "prompt_ref": "prompt:tori",
          "metadata": {
            "color": "info",
            "human_tone": true,
            "mode": "all",
            "temperature": 0.9,
            "runtime_ids": ["opencode", "kilocode"]
          }
        },
        {
          "@id": "policy:tori-no-direct-mutation",
          "@type": "Policy",
          "label": "Relaxed policy override",
          "description": "Attempt to relax builtin deny policy",
          "policy_kind_id": "policy-kind:authorization",
          "effect": "policy-effect:deny",
          "subject_agent_ids": ["agent:tori"],
          "tool_ids": []
        }
      ]
    }, null, 2), "utf8");
    await writeFile(join(runtimePaths.ontologyDir, "prompts", "tori.md"), "LOCAL Tori prompt", "utf8");

    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const configs = await runtime.buildRuntimeAgentConfigs("opencode");
    assert.equal(runtime.getRegistry().getAgent("agent:tori")?.label, "Tori");
    assert.equal(configs.tori.temperature, 0.3);
    assert.equal(configs.tori.color, "error");
    assert.equal(configs.tori.prompt, "LOCAL Tori prompt");
    assert.equal(runtime.getRegistry().get("policy:tori-no-direct-mutation")?.label, "Tori no direct mutation");
    assert.equal(configs.tori.tools.trigger_ci_check, undefined);
    assert.equal(configs.tori.tools.save_checkpoint, undefined);
    assert.equal(configs.tori.tools.scratchpad, undefined);
  });

  test("local ontology can add new agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-extend-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    await mkdir(runtimePaths.ontologyDir, { recursive: true });
    await writeFile(join(runtimePaths.ontologyDir, "new-agent.jsonld"), JSON.stringify({
      "@context": "https://tori-agent.dev/ontology/2026/core/context",
      "@graph": [
        {
          "@id": "agent:custom:auditor",
          "@type": "Agent",
          "label": "Custom auditor",
          "description": "Project-local agent",
          "role_ids": ["role:reviewer"],
          "capability_ids": ["capability:review"],
          "tool_ids": ["tool:read", "tool:bash", "tool:glob", "tool:grep", "tool:project_state", "tool:check_artifacts", "tool:run_mechanical_checks"],
          "prompt_ref": "prompt:reviewer",
          "metadata": {
            "color": "success",
            "human_tone": false,
            "mode": "subagent",
            "temperature": 0.1,
            "runtime_ids": ["opencode"]
          }
        }
      ]
    }, null, 2), "utf8");

    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const configs = await runtime.buildRuntimeAgentConfigs("opencode");
    assert.ok(runtime.getRegistry().getAgent("agent:custom:auditor"));
    assert.ok(configs["custom:auditor"]);
  });

  test("startup does not overwrite or delete local ontology files", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-preserve-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    await mkdir(runtimePaths.ontologyDir, { recursive: true });
    const localFile = join(runtimePaths.ontologyDir, "keep.jsonld");
    const original = JSON.stringify({
      "@context": "https://tori-agent.dev/ontology/2026/core/context",
      "@graph": []
    }, null, 2);
    await writeFile(localFile, original, "utf8");

    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });
    await plugin.event({ event: { type: "session.created" } });

    assert.equal(await readFile(localFile, "utf8"), original);
    assert.deepEqual((await readdir(runtimePaths.ontologyDir)).sort(), ["keep.jsonld"]);
  });

  test("local skill override wins over builtin fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-skill-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    await mkdir(join(runtimePaths.skillsDir, "caveman"), { recursive: true });
    await writeFile(join(runtimePaths.skillsDir, "caveman", "SKILL.md"), "LOCAL CAVEMAN", "utf8");
    const readOnly = buildReadOnlyTools(root, runtimePaths);
    const local = await readOnly.skill.execute({ name: "caveman" });
    const builtin = await readOnly.skill.execute({ name: "spec-writer" });
    assert.equal(local, "LOCAL CAVEMAN");
    assert.match(builtin, /spec/i);
  });
});
