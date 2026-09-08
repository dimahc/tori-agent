import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimePaths } from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";
import { buildReadOnlyTools, buildWriteTools } from "../dist/plugin/index.js";
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

  test("local ontology override changes builtin agent config and prompt", async () => {
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
          "description": "Project-local Tori override",
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
            "tool:run_mechanical_checks",
            "tool:check_artifacts",
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
        }
      ]
    }, null, 2), "utf8");
    await writeFile(join(runtimePaths.ontologyDir, "prompts", "tori.md"), "LOCAL Tori prompt", "utf8");

    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const configs = await runtime.buildRuntimeAgentConfigs("opencode");
    assert.equal(runtime.getRegistry().getAgent("agent:tori")?.label, "Tori Override");
    assert.equal(configs.tori.temperature, 0.9);
    assert.equal(configs.tori.color, "info");
    assert.equal(configs.tori.prompt, "LOCAL Tori prompt");
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
