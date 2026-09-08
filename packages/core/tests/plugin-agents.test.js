import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimePaths } from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";
import { buildReadOnlyTools, buildWriteTools } from "../dist/plugin/index.js";
import { buildPlugin } from "../../harness/dist/plugin.js";

describe("plugin ontology integration", () => {
  test("runtime builds host agent configs from ontology", async () => {
    const runtime = await initializeOntologyRuntime();
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
    const readOnly = buildReadOnlyTools(root, runtimePaths, runtimePaths.skillsDir);
    const write = buildWriteTools(root, runtimePaths, "opencode");
    assert.ok(readOnly.workflow_state);
    assert.ok(write.transition_stage);
    assert.ok(write.record_check_result);
  });

  test("session authorization binds to actual tracked agent", async () => {
    const runtime = await initializeOntologyRuntime();
    const root = await mkdtemp(join(tmpdir(), "tori-plugin-auth-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
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
});
