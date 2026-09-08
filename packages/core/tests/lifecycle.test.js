import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ARTIFACT_STATUS, ARTIFACT_TYPE, buildRuntimePaths } from "@tori-agent/ontology";
import {
  checkArtifacts,
  completePlan,
  getReviewCheck,
  markBlockDone,
  parseReviewChecks,
  projectState,
  registerSpecImpl,
  runMechanicalChecks,
  saveCheckpoint,
  splitCommandLine,
  truncateOutput,
  writeAppend,
} from "../dist/tools/lifecycle.js";

describe("lifecycle strict ontology", () => {
  let root;
  let runtimePaths;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tori-lifecycle-"));
    runtimePaths = buildRuntimePaths(root, "opencode", join(root, ".opencode"));
    await mkdir(runtimePaths.execPlansDir, { recursive: true });
    await mkdir(runtimePaths.specsDir, { recursive: true });
    await mkdir(runtimePaths.briefsDir, { recursive: true });
    await writeFile(
      join(root, "AGENTS.md"),
      [
        "# AGENTS.md",
        "",
        "## Review Checks",
        "",
        "### Lint",
        "",
        "- lint: node -e \"process.exit(0)\"",
        "",
        "### Tests",
        "",
        "- verify-expansion: node -e \"process.exit(0)\"",
      ].join("\n"),
      "utf8",
    );
  });

  test("splitCommandLine handles quoted values", () => {
    assert.deepEqual(splitCommandLine('node -e "console.log(1)"'), ["node", "-e", "console.log(1)"]);
  });

  test("truncateOutput truncates long output", () => {
    const value = Array.from({ length: 120 }, (_, index) => `line ${index}`).join("\n");
    assert.match(truncateOutput(value), /lines omitted/);
  });

  test("registerSpecImpl creates strict ontology frontmatter", async () => {
    const result = await registerSpecImpl(root, runtimePaths, "feature.md", "Feature Spec");
    assert.equal(result.artifact_id, "spec:feature");
    const state = await projectState(root, runtimePaths);
    assert.equal(state.specs[0].artifact_type_id, ARTIFACT_TYPE.spec);
  });

  test("markBlockDone and completePlan use strict status ids", async () => {
    const planPath = join(runtimePaths.execPlansDir, "plan.md");
    await writeFile(
      planPath,
      [
        "---",
        "artifact_id: exec-plan:test",
        `artifact_type_id: ${ARTIFACT_TYPE.execPlan}`,
        `status_id: ${ARTIFACT_STATUS.active}`,
        'title: "Plan"',
        "created_at: 2026-09-08T00:00:00.000Z",
        "---",
        "",
        "- [ ] Task one",
      ].join("\n"),
      "utf8",
    );
    const mark = await markBlockDone(root, runtimePaths, "plan.md", "Task one");
    assert.equal(mark.all_done, true);
    const completed = await completePlan(root, runtimePaths, "plan.md");
    assert.equal(completed.status_id, ARTIFACT_STATUS.completed);
  });

  test("checkArtifacts detects missing links and stale statuses", async () => {
    await writeFile(
      join(runtimePaths.execPlansDir, "plan.md"),
      [
        "---",
        "artifact_id: exec-plan:test",
        `artifact_type_id: ${ARTIFACT_TYPE.execPlan}`,
        `status_id: ${ARTIFACT_STATUS.completed}`,
        'title: "Plan"',
        "created_at: 2026-09-08T00:00:00.000Z",
        "---",
        "",
        "- [ ] Task one",
      ].join("\n"),
      "utf8",
    );
    const result = await checkArtifacts(root, runtimePaths);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.type === "stale_status"));
  });

  test("runMechanicalChecks executes repo-defined commands", async () => {
    const result = await runMechanicalChecks(root);
    assert.equal(result.ok, true);
    assert.equal(result.checks.length, 2);
  });

  test("review checks parse and resolve by id", async () => {
    const parsed = parseReviewChecks(await readFile(join(root, "AGENTS.md"), "utf8"));
    assert.deepEqual(parsed.map((check) => check.id), ["lint", "verify-expansion"]);
    const lint = await getReviewCheck(root, "lint");
    assert.equal(lint?.command, 'node -e "process.exit(0)"');
  });

  test("saveCheckpoint and writeAppend write files", async () => {
    const checkpoint = await saveCheckpoint(root, runtimePaths, "resume.json", "sum", "remain");
    assert.ok(checkpoint.bytes > 0);
    const appended = await writeAppend(root, "notes.md", "hello");
    assert.ok(appended.bytes > 0);
  });
});
