import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimePaths } from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";
import { deriveSessionTitle, isDefaultSessionTitle } from "../dist/index.js";
import { buildReadOnlyTools, buildWriteTools, createAuthorizedToolExecutor, createBudgetAwareToolExecutor } from "../dist/plugin/index.js";
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
    assert.equal(configs.tori.tools.run_mechanical_checks, undefined);
    assert.equal(configs.tori.tools.trigger_ci_check, undefined);
    assert.equal(configs.tori.tools.save_checkpoint, undefined);
    assert.equal(configs.tori.tools.scratchpad, undefined);
    assert.ok(configs["specialist:software-engineer"]);
  });

  test("tool builders expose ontology-native tool set", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const readOnly = buildReadOnlyTools(root, runtimePaths);
    const write = buildWriteTools(root, runtimePaths, "opencode");
    assert.ok(readOnly.workflow_state);
    assert.ok(write.transition_stage);
    assert.ok(write.record_check_result);
    assert.ok(write.trigger_ci_check);
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
      () => wrapped.register_spec.execute({ spec_file: "blocked.md", title: "Blocked" }, { sessionID: "s-direct", directory: root, agent: "tori" }),
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

  test("first meaningful user request generates stable session title once", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-title-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    const first = {};
    await plugin["chat.message"]({
      sessionID: "s-title",
      role: "user",
      message: "  Fix session naming to use first user request instead of timestamp fallback.  ",
      currentTitle: "Untitled Session",
    }, first);

    assert.deepEqual(first, {
      title: "Fix session naming to use first user request instead of timestamp fallback",
      shouldRename: true,
      source: "first-user-request",
    });

    const second = {};
    await plugin["chat.message"]({
      sessionID: "s-title",
      role: "user",
      message: "Actually make it rename on every message",
      currentTitle: first.title,
    }, second);

    assert.deepEqual(second, {});
  });

  test("blank and noise messages do not generate title", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-noise-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    const blank = {};
    await plugin["session.title"]({
      sessionID: "s-noise",
      role: "user",
      message: "   ",
      currentTitle: "Untitled Session",
    }, blank);
    assert.deepEqual(blank, {});

    const noise = {};
    await plugin["session.title"]({
      sessionID: "s-noise",
      role: "user",
      message: "hello",
      currentTitle: "Untitled Session",
    }, noise);
    assert.deepEqual(noise, {});

    const meaningful = {};
    await plugin["session.title"]({
      sessionID: "s-noise",
      role: "user",
      message: "Add explicit session title hook to plugin contract",
      currentTitle: "Untitled Session",
    }, meaningful);
    assert.deepEqual(meaningful, {
      title: "Add explicit session title hook to plugin contract",
      shouldRename: true,
      source: "first-user-request",
    });
  });

  test("title flow does not affect session auth behavior", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-title-auth-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-auth", agent: "tori" }, {});
    await plugin["chat.message"]({
      sessionID: "s-auth",
      role: "user",
      message: "Check auth still denies write for tori",
      currentTitle: "Untitled Session",
    }, {});

    const permission = { status: "allow" };
    await plugin["permission.ask"]({ sessionID: "s-auth", type: "write", pattern: "README.md" }, permission);
    assert.equal(permission.status, "deny");
  });

  test("assistant output hook rewrites repeated self-talk paragraphs", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-output-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    const output = {};
    await plugin["chat.message"]({ sessionID: "s-out", agent: "tori" }, {});
    await plugin["assistant.output"]({
      sessionID: "s-out",
      agent: "tori",
      text: "Let me think through this.\n\nResult ready.\n\nResult ready.",
      attempt: 0,
    }, output);

    assert.equal(output.status, "allow");
    assert.equal(output.reason, "Removed self-talk and duplicate output");
    assert.equal(output.text, "Result ready.");
  });

  test("assistant output hook blocks repeated self-talk after one retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-output-block-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    const output = {};
    await plugin["chat.message"]({ sessionID: "s-out-block", agent: "tori" }, {});
    await plugin["assistant.output"]({
      sessionID: "s-out-block",
      agent: "tori",
      text: "Let me think. I should check. Let me think. I should check.",
      attempt: 1,
    }, output);

    assert.equal(output.status, "block");
    assert.match(output.reason, /self-talk persists|Repeated self-talk/);
  });

  test("harness config merge keeps ontology-derived agent config authoritative", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-merge-"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });
    const config = await plugin.config({
      agent: {
        tori: {
          prompt: "host override",
          tools: { write: true },
          permission: { write: "allow" },
        },
      },
    });
    assert.notEqual(config.agent.tori.prompt, "host override");
    assert.equal(config.agent.tori.tools.write, undefined);
    assert.equal(config.agent.tori.permission.write, undefined);
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
