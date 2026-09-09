import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimePaths } from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../dist/ontology/runtime.js";

describe("ontology compiler deterministic overrides", () => {
  test("applies same-directory overrides in sorted file order", async () => {
    const root = await mkdtemp(join(tmpdir(), "tori-compiler-order-"));
    const runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    await mkdir(runtimePaths.ontologyDir, { recursive: true });

    const basePolicy = {
      "@id": "policy:custom-order",
      "@type": "Policy",
      label: "Alpha policy",
      description: "Alpha file version",
      policy_kind_id: "policy-kind:authorization",
      effect: "policy-effect:deny",
      subject_agent_ids: ["agent:tori"],
      tool_ids: ["tool:read"],
    };

    await writeFile(join(runtimePaths.ontologyDir, "z-last.jsonld"), JSON.stringify({
      "@context": "https://tori-agent.dev/ontology/2026/core/context",
      "@graph": [{ ...basePolicy, label: "Zulu policy", description: "Zulu file version" }],
    }, null, 2), "utf8");
    await writeFile(join(runtimePaths.ontologyDir, "a-first.jsonld"), JSON.stringify({
      "@context": "https://tori-agent.dev/ontology/2026/core/context",
      "@graph": [basePolicy],
    }, null, 2), "utf8");

    const runtime = await initializeOntologyRuntime({ runtimePaths });
    const policy = runtime.getRegistry().get("policy:custom-order");
    assert.ok(policy);
    assert.equal(policy?.label, "Zulu policy");
    assert.equal(policy?.description, "Zulu file version");
  });
});
