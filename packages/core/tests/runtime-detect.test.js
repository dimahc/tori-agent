import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { detectRuntime } from "../../harness/dist/index.js";

describe("detectRuntime", () => {
  test("env wins", () => {
    const original = process.env.TORI_RUNTIME;
    process.env.TORI_RUNTIME = "kilocode";
    assert.equal(detectRuntime(), "kilocode");
    if (original === undefined) delete process.env.TORI_RUNTIME;
    else process.env.TORI_RUNTIME = original;
  });

  test("argv heuristic picks opencode", () => {
    const original = [...process.argv];
    const originalEnv = process.env.TORI_RUNTIME;
    delete process.env.TORI_RUNTIME;
    process.argv = ["node", "opencode"];
    assert.equal(detectRuntime(), "opencode");
    process.argv = original;
    if (originalEnv !== undefined) process.env.TORI_RUNTIME = originalEnv;
  });
});
