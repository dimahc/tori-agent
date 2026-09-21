import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimePaths } from "@tori-agent/ontology";
import { initializeOntologyRuntime, understandAndReformulate } from "../dist/index.js";
import { buildPlugin } from "../../harness/dist/plugin.js";

describe("understandAndReformulate", () => {
  test("reformulates prompt with agent label, roles, capabilities, and reasoning", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-dispatch-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });

    const result = understandAndReformulate("Fix the login bug", "agent:specialist:software-engineer", runtime);

    assert.ok(result.includes("Specialist software engineer") || result.includes("specialist:software-engineer"),
      "Should include agent label");
    assert.ok(result.includes("Capabilities:"), "Should include capabilities section");
    assert.ok(result.includes("Reasoning mode:"), "Should include reasoning mode section");
    assert.ok(result.includes("Fix the login bug"), "Should preserve original prompt");
  });

  test("preserves original prompt when agent has no reasoning mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-dispatch-nomode-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });

    const result = understandAndReformulate("Deploy the service", "agent:specialist:software-engineer", runtime);

    assert.ok(result.includes("Deploy the service"), "Should preserve original prompt");
    assert.ok(result.includes("Capabilities:"), "Should include capabilities");
  });

  test("passes through unchanged for unknown agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-dispatch-unknown-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });

    const result = understandAndReformulate("Do something", "agent:nonexistent", runtime);

    assert.equal(result, "Do something", "Should return original prompt unchanged for unknown agent");
  });

  test("passes through unchanged for empty prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-dispatch-empty-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });

    assert.equal(understandAndReformulate("", "agent:specialist:software-engineer", runtime), "");
    assert.equal(understandAndReformulate("   ", "agent:specialist:software-engineer", runtime), "   ");
    assert.equal(understandAndReformulate("", "agent:tori", runtime), "");
  });

  test("passes through unchanged for non-string prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-dispatch-typo-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });

    assert.equal(understandAndReformulate(null, "agent:tori", runtime), null);
  });

  test("includes reasoning constraints when agent has reasoning mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-dispatch-reasoning-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const runtime = await initializeOntologyRuntime({ runtimePaths });

    const result = understandAndReformulate("Write a test", "agent:specialist:software-engineer", runtime);

    assert.ok(
      result.includes("Principles:") || result.includes("Forbidden patterns:") || result.includes("Self-check requirements:") || result.includes("Reasoning mode:"),
      "Should include reasoning constraints",
    );
  });
});

describe("dispatch harness integration", () => {
  test("tool.execute.before reformulates task description via hook", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-dispatch-hook-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-dispatch-hook", agent: "specialist:software-engineer" }, {});

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "s-dispatch-hook", callID: "1" },
      { args: { agent: "specialist:software-engineer", description: "Implement user authentication" } },
    );
  });

  test("tool.execute.before rejects task with unknown agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-dispatch-unknown-agent-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-dispatch-unknown", agent: "tori" }, {});

    await assert.rejects(
      () =>
        plugin["tool.execute.before"](
          { tool: "task", sessionID: "s-dispatch-unknown", callID: "1" },
          { args: { agent: "agent:nonexistent", description: "do something" } },
        ),
      /Task agent must be an ontologically registered agent/,
    );
  });

  test("tool.execute.before allows task with empty description", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-dispatch-empty-desc-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    const factory = buildPlugin({ runtime: "opencode", configPath: join(root, ".opencode", "AGENTS.md") });
    const plugin = await factory({ directory: root, worktree: root });

    await plugin["chat.message"]({ sessionID: "s-dispatch-empty", agent: "specialist:software-engineer" }, {});

    await plugin["tool.execute.before"](
      { tool: "task", sessionID: "s-dispatch-empty", callID: "1" },
      { args: { agent: "specialist:software-engineer", description: "" } },
    );
  });
});
