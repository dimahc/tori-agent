import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ShaclValidator } from "../src/validation/shacl.js";

describe("ShaclValidator strict ontology", () => {
  const validator = new ShaclValidator();

  test("accepts valid strict ontology agent", () => {
    const result = validator.validate(
      "agent:test",
      {
        "@id": "agent:test",
        "@type": "Agent",
        label: "Test",
        description: "desc",
        role_ids: ["role:test"],
        capability_ids: ["capability:test"],
        tool_ids: ["tool:read"],
        prompt_ref: "prompt:test",
        metadata: { color: "info", default_main_session: false, human_tone: false, mode: "subagent", temperature: 0.1, runtime_ids: ["opencode"] },
      } as any,
      "agent.jsonld",
    );
    assert.equal(result.valid, true);
  });

  test("rejects missing required fields", () => {
    const result = validator.validate(
      "agent:test",
      {
        "@id": "agent:test",
        "@type": "Agent",
        label: "Test",
        description: "desc",
      } as any,
      "agent.jsonld",
    );
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.property === "role_ids"));
  });
});
