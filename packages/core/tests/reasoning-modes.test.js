import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimePaths } from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";

const MODES = [
  "reasoning-mode:evidence-first",
  "reasoning-mode:falsification",
  "reasoning-mode:impact-ranked",
  "reasoning-mode:verify-as-you-go",
  "reasoning-mode:compare-then-decide",
  "reasoning-mode:plan-apply-verify",
  "reasoning-mode:threat-model-first",
  "reasoning-mode:source-grounded",
  "reasoning-mode:artifact-grounded",
  "reasoning-mode:diff-as-truth",
];

async function buildConfigs() {
  const root = await mkdtemp(join(tmpdir(), "tori-reasoning-modes-"));
  const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
  const runtime = await initializeOntologyRuntime({ runtimePaths });
  const configs = await runtime.buildRuntimeAgentConfigs("opencode");
  return { runtime, configs };
}

describe("reasoning mode model", () => {
  test("every builtin agent resolves a complete reasoning contract", async () => {
    const { configs } = await buildConfigs();
    for (const [key, config] of Object.entries(configs)) {
      assert.ok(config.reasoning, `agent ${key} missing reasoning`);
      assert.ok(MODES.includes(config.reasoning.id), `agent ${key} unknown mode ${config.reasoning.id}`);
      assert.ok(config.reasoning.label.length > 0);
      assert.ok(config.reasoning.source.length > 0);
      assert.ok(config.reasoning.principles.length > 0, `agent ${key} empty principles`);
      assert.ok(config.reasoning.forbidden_patterns.length > 0, `agent ${key} empty forbidden_patterns`);
      assert.ok(config.reasoning.self_check.length > 0, `agent ${key} empty self_check`);
      assert.ok(config.reasoning.decision_threshold.length > 0, `agent ${key} empty decision_threshold`);
    }
  });

  test("agent inherits reasoning mode from role default", async () => {
    const { configs } = await buildConfigs();
    assert.equal(configs.tori.reasoning.id, "reasoning-mode:evidence-first");
    assert.equal(configs.tori.reasoning.source, "role:orchestrator");
    assert.equal(configs["reviewer:quality"].reasoning.id, "reasoning-mode:falsification");
    assert.equal(configs["reviewer:quality"].reasoning.source, "role:reviewer");
    assert.equal(configs["specialist:software-engineer"].reasoning.id, "reasoning-mode:verify-as-you-go");
    assert.equal(configs["specialist:software-engineer"].reasoning.source, "role:software_engineer");
    assert.equal(configs["scribe:adr"].reasoning.id, "reasoning-mode:artifact-grounded");
  });

  test("agent-level reasoning override beats role default", async () => {
    const { configs } = await buildConfigs();
    assert.equal(configs["reviewer:enhance"].reasoning.id, "reasoning-mode:impact-ranked");
    assert.equal(configs["reviewer:enhance"].reasoning.source, "agent:reviewer:enhance");
    assert.notEqual(configs["reviewer:enhance"].reasoning.id, configs["reviewer:quality"].reasoning.id);
  });

  test("reasoning arrays are deep-cloned between configs", async () => {
    const { configs } = await buildConfigs();
    const engineer = configs["specialist:software-engineer"];
    const architect = configs["specialist:software-architect"];
    assert.notEqual(engineer.reasoning.principles, architect.reasoning.principles);
    engineer.reasoning.principles.push("mutated");
    assert.ok(!architect.reasoning.principles.includes("mutated"));
  });

  test("unknown reasoning mode id on a role is rejected at runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-reasoning-badmode-"));
    const ontDir = join(root, ".opencode", "ontology");
    await mkdir(ontDir, { recursive: true });
    await writeFile(
      join(ontDir, "overrides.jsonld"),
      JSON.stringify({
        "@context": "https://tori-agent.dev/ontology/2026/core/context",
        "@graph": [
          {
            "@id": "role:reviewer",
            "@type": "Role",
            "label": "Reviewer",
            "description": "Override",
            "capability_ids": ["capability:review"],
            "permission_grants": [],
            "reasoning_mode_id": "reasoning-mode:does-not-exist",
          },
        ],
      }),
    );
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    await assert.rejects(
      () => initializeOntologyRuntime({ runtimePaths }),
      /references unknown reasoning mode/,
    );
  });

  test("builtin agent without any reasoning mode is rejected at runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-reasoning-nomode-"));
    const ontDir = join(root, ".opencode", "ontology");
    await mkdir(ontDir, { recursive: true });
    await writeFile(
      join(ontDir, "overrides.jsonld"),
      JSON.stringify({
        "@context": "https://tori-agent.dev/ontology/2026/core/context",
        "@graph": [
          {
            "@id": "role:reviewer",
            "@type": "Role",
            "label": "Reviewer",
            "description": "Override",
            "capability_ids": ["capability:review"],
            "permission_grants": [],
          },
        ],
      }),
    );
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    await assert.rejects(
      () => initializeOntologyRuntime({ runtimePaths }),
      /resolves no reasoning mode/,
    );
  });
});