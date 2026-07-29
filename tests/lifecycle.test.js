// tests/lifecycle.test.js
// Comprehensive test suite for tools/lifecycle.js
// Uses only Node.js built-ins: node:test, node:assert, node:fs/promises, node:os, node:path

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { writeFile as fsWriteFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

import {
  projectState,
  markBlockDone,
  completePlan,
  registerSpec,
  checkArtifacts,
  runMechanicalChecks,
  executeCheckCommand,
  truncateOutput,
  splitCommandLine,
} from "../tools/lifecycle.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function writeFile(dir, relPath, content) {
  const abs = join(dir, relPath);
  await mkdir(join(dir, relPath, ".."), { recursive: true });
  await fsWriteFile(abs, content, "utf-8");
  return abs;
}

const DEFAULT_PATHS = {
  specs: "docs/specs",
  execPlans: "docs/exec-plans",
  briefs: "docs/briefs",
};

// ── projectState ─────────────────────────────────────────────────────────────

describe("projectState", () => {
  test("empty project (dirs don't exist) → all arrays empty", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-projectState-"));
    try {
      const result = await projectState(tmpDir, DEFAULT_PATHS);

      assert.deepEqual(result.specs, []);
      assert.deepEqual(result.exec_plans, []);
      assert.deepEqual(result.briefs, []);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("one spec file with frontmatter → parsed correctly into specs[0]", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-projectState-"));
    try {
      await writeFile(
        tmpDir,
        "docs/specs/my-spec.md",
        `---\ntitle: "My Feature"\nstatus: active\ncreated: 2026-01-01\nid: SPEC-001\ncriticality: high\n---\n\n# My Feature\n`
      );

      const result = await projectState(tmpDir, DEFAULT_PATHS);

      assert.equal(result.specs.length, 1);
      const spec = result.specs[0];
      assert.equal(spec.title, "My Feature");
      assert.equal(spec.status, "active");
      assert.equal(spec.created, "2026-01-01");
      assert.equal(spec.id, "SPEC-001");
      assert.equal(spec.criticality, "high");
      assert.match(spec.file, /my-spec\.md$/);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("one spec file without frontmatter → all fields null", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-projectState-"));
    try {
      await writeFile(
        tmpDir,
        "docs/specs/no-frontmatter.md",
        `# Just a title\n\nNo frontmatter here.\n`
      );

      const result = await projectState(tmpDir, DEFAULT_PATHS);
      const spec = result.specs.find((s) => s.file.includes("no-frontmatter"));

      assert.notEqual(spec, undefined);
      assert.equal(spec.title, null);
      assert.equal(spec.status, null);
      assert.equal(spec.id, null);
      assert.equal(spec.criticality, null);
      assert.equal(spec.created, null);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("one exec-plan with checked and unchecked blocks → correct block counts", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-projectState-"));
    try {
      await writeFile(
        tmpDir,
        "docs/exec-plans/plan-a.md",
        `---\nstatus: in-progress\n---\n\n## Tasks\n\n- [x] First task\n- [ ] Second task\n`
      );

      const result = await projectState(tmpDir, DEFAULT_PATHS);

      assert.equal(result.exec_plans.length, 1);
      const plan = result.exec_plans[0];
      assert.equal(plan.blocks.total, 2);
      assert.equal(plan.blocks.checked, 1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("exec-plan with all blocks checked but status != completed → warning present", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-projectState-"));
    try {
      await writeFile(
        tmpDir,
        "docs/exec-plans/plan-stale.md",
        `---\nstatus: in-progress\n---\n\n- [x] Task one\n- [x] Task two\n`
      );

      const result = await projectState(tmpDir, DEFAULT_PATHS);
      const plan = result.exec_plans.find((p) => p.file.includes("plan-stale"));

      assert.notEqual(plan, undefined);
      assert.ok(
        "warning" in plan,
        "expected a warning field when all blocks are checked but status != completed"
      );
      assert.match(plan.warning, /status/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── markBlockDone ─────────────────────────────────────────────────────────────

describe("markBlockDone", () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-markBlock-"));
    await mkdir(join(tmpDir, "docs/exec-plans"), { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("mark unchecked block → becomes checked, returns correct metadata", async () => {
    await writeFile(
      tmpDir,
      "docs/exec-plans/plan.md",
      `---\nstatus: in-progress\n---\n\n- [ ] Do the thing\n- [ ] Another task\n`
    );

    const result = await markBlockDone(tmpDir, "docs/exec-plans/plan.md", "Do the thing");

    assert.equal(result.was, "unchecked");
    assert.equal(result.now, "checked");
    assert.equal(result.all_done, false);
  });

  test("mark already-checked block → no error, was: checked", async () => {
    await writeFile(
      tmpDir,
      "docs/exec-plans/plan-already.md",
      `---\nstatus: in-progress\n---\n\n- [x] Already done\n- [ ] Still pending\n`
    );

    const result = await markBlockDone(
      tmpDir,
      "docs/exec-plans/plan-already.md",
      "Already done"
    );

    assert.equal(result.was, "checked");
    assert.equal(result.now, "checked");
  });

  test("last remaining unchecked block → all_done: true and hint present", async () => {
    await writeFile(
      tmpDir,
      "docs/exec-plans/plan-last.md",
      `---\nstatus: in-progress\n---\n\n- [x] First task\n- [ ] Last task\n`
    );

    const result = await markBlockDone(
      tmpDir,
      "docs/exec-plans/plan-last.md",
      "Last task"
    );

    assert.equal(result.all_done, true);
    assert.ok("hint" in result, "expected a hint field when all blocks are done");
    assert.ok(result.hint.length > 0);
  });

  test("block name not found → throws with 'not found' and lists available blocks", async () => {
    await writeFile(
      tmpDir,
      "docs/exec-plans/plan-missing.md",
      `---\nstatus: in-progress\n---\n\n- [ ] Real task one\n- [ ] Real task two\n`
    );

    await assert.rejects(
      () => markBlockDone(tmpDir, "docs/exec-plans/plan-missing.md", "nonexistent block"),
      (err) => {
        assert.match(err.message, /block .+ not found/i);
        assert.match(err.message, /Real task one/);
        assert.match(err.message, /Real task two/);
        return true;
      }
    );
  });

  test("ambiguous name matching multiple blocks → throws with 'multiple blocks'", async () => {
    await writeFile(
      tmpDir,
      "docs/exec-plans/plan-ambiguous.md",
      `---\nstatus: in-progress\n---\n\n- [ ] Setup database\n- [ ] Setup cache\n`
    );

    await assert.rejects(
      () => markBlockDone(tmpDir, "docs/exec-plans/plan-ambiguous.md", "Setup"),
      (err) => {
        assert.match(err.message, /multiple blocks/i);
        return true;
      }
    );
  });

  test("file not found → throws with 'file not found'", async () => {
    await assert.rejects(
      () => markBlockDone(tmpDir, "docs/exec-plans/does-not-exist.md", "anything"),
      (err) => {
        assert.match(err.message, /file not found/i);
        return true;
      }
    );
  });
});

// ── completePlan ──────────────────────────────────────────────────────────────

describe("completePlan", () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-completePlan-"));
    await mkdir(join(tmpDir, "docs/exec-plans"), { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("all blocks checked → sets status: completed, returns correct shape", async () => {
    await writeFile(
      tmpDir,
      "docs/exec-plans/done.md",
      `---\nstatus: in-progress\n---\n\n- [x] Task A\n- [x] Task B\n`
    );

    const result = await completePlan(tmpDir, "docs/exec-plans/done.md");

    assert.equal(result.status, "completed");
    assert.equal(result.updated, new Date().toISOString().slice(0, 10));
    assert.equal(result.file, "docs/exec-plans/done.md");
  });

  test("all blocks checked → file on disk reflects status: completed", async () => {
    await writeFile(
      tmpDir,
      "docs/exec-plans/done-disk.md",
      `---\nstatus: in-progress\n---\n\n- [x] Single task\n`
    );

    await completePlan(tmpDir, "docs/exec-plans/done-disk.md");

    const { readFile: rf } = await import("node:fs/promises");
    const content = await rf(join(tmpDir, "docs/exec-plans/done-disk.md"), "utf-8");
    assert.match(content, /status: completed/);
  });

  test("has unchecked block → throws about unchecked blocks", async () => {
    await writeFile(
      tmpDir,
      "docs/exec-plans/partial.md",
      `---\nstatus: in-progress\n---\n\n- [x] Done\n- [ ] Not done\n`
    );

    await assert.rejects(
      () => completePlan(tmpDir, "docs/exec-plans/partial.md"),
      (err) => {
        assert.match(err.message, /unchecked/i);
        return true;
      }
    );
  });

  test("no frontmatter → throws about frontmatter", async () => {
    await writeFile(
      tmpDir,
      "docs/exec-plans/no-fm.md",
      `# Just a heading\n\n- [x] Some task\n`
    );

    await assert.rejects(
      () => completePlan(tmpDir, "docs/exec-plans/no-fm.md"),
      (err) => {
        assert.match(err.message, /[Ff]rontmatter/i);
        return true;
      }
    );
  });

  test("status field missing from frontmatter → throws about status field", async () => {
    await writeFile(
      tmpDir,
      "docs/exec-plans/no-status.md",
      `---\ntitle: "No status here"\n---\n\n- [x] Task\n`
    );

    await assert.rejects(
      () => completePlan(tmpDir, "docs/exec-plans/no-status.md"),
      (err) => {
        assert.match(err.message, /'status' missing/i);
        return true;
      }
    );
  });

  test("file not found → throws with 'file not found'", async () => {
    await assert.rejects(
      () => completePlan(tmpDir, "docs/exec-plans/ghost.md"),
      (err) => {
        assert.match(err.message, /file not found/i);
        return true;
      }
    );
  });
});

// ── registerSpec ──────────────────────────────────────────────────────────────

describe("registerSpec", () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-registerSpec-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("new file → creates file with correct frontmatter and returns { created: true, file }", async () => {
    const result = await registerSpec(
      tmpDir,
      DEFAULT_PATHS,
      "my-feature.md",
      "My Feature"
    );

    assert.equal(result.created, true);
    assert.ok(result.file.includes("my-feature.md"));

    const { readFile: rf } = await import("node:fs/promises");
    const content = await rf(join(tmpDir, result.file), "utf-8");

    assert.match(content, /^---\n/);
    assert.match(content, /title: "My Feature"/);
    assert.match(content, /status: draft/);
    assert.match(content, /created: \d{4}-\d{2}-\d{2}/);
    assert.match(content, /---\n/);
    assert.match(content, /# My Feature/);
  });

  test("file already exists → throws with 'already exists'", async () => {
    await mkdir(join(tmpDir, DEFAULT_PATHS.specs), { recursive: true });
    await writeFile(tmpDir, `${DEFAULT_PATHS.specs}/existing.md`, `# Existing\n`);

    await assert.rejects(
      () => registerSpec(tmpDir, DEFAULT_PATHS, "existing.md", "Existing"),
      (err) => {
        assert.match(err.message, /already exists/i);
        return true;
      }
    );
  });

  test("path traversal → throws with 'escapes project root'", async () => {
    await assert.rejects(
      () =>
        registerSpec(
          tmpDir,
          DEFAULT_PATHS,
          "../../etc/passwd",
          "Evil"
        ),
      (err) => {
        assert.match(err.message, /escapes project root/i);
        return true;
      }
    );
  });

  test("spec file in a subdirectory that doesn't exist yet → directory is created", async () => {
    const result = await registerSpec(
      tmpDir,
      DEFAULT_PATHS,
      "subdir/deep-spec.md",
      "Deep Spec"
    );

    assert.equal(result.created, true);

    const { existsSync } = await import("node:fs");
    assert.ok(existsSync(join(tmpDir, result.file)));
  });
});

// ── checkArtifacts ────────────────────────────────────────────────────────────

describe("checkArtifacts", () => {
  test("clean project (no files) → no problems, clean summary", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-check-clean-"));
    try {
      const result = await checkArtifacts(tmpDir, DEFAULT_PATHS);
      assert.deepEqual(result.problems, []);
      assert.equal(result.summary, "All artifacts are consistent.");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("exec-plan: all blocks checked, status not completed → blocking plan_stale_status", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-checkArtifacts-"));
    try {
      await writeFile(
        tmpDir,
        "docs/exec-plans/stale.md",
        `---\nstatus: in-progress\nbrief: docs/briefs/stale-brief.md\n---\n\n- [x] Block A\n- [x] Block B\n`
      );
      await writeFile(
        tmpDir,
        "docs/briefs/stale-brief.md",
        `---\nexec_plan: docs/exec-plans/stale.md\n---\n\n# Brief\n`
      );

      const result = await checkArtifacts(tmpDir, DEFAULT_PATHS);

      const problem = result.problems.find((p) => p.type === "plan_stale_status");
      assert.notEqual(problem, undefined, "expected a plan_stale_status problem");
      assert.equal(problem.severity, "blocking");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("exec-plan: missing brief field → warning plan_missing_brief", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-checkArtifacts-"));
    try {
      await writeFile(
        tmpDir,
        "docs/exec-plans/no-brief.md",
        `---\nstatus: in-progress\n---\n\n- [ ] Task\n`
      );

      const result = await checkArtifacts(tmpDir, DEFAULT_PATHS);

      const problem = result.problems.find(
        (p) => p.type === "plan_missing_brief" && p.file.includes("no-brief")
      );
      assert.notEqual(problem, undefined, "expected a plan_missing_brief problem");
      assert.equal(problem.severity, "warning");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("exec-plan: brief field points to non-existent file → blocking plan_brief_dead", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-checkArtifacts-"));
    try {
      await writeFile(
        tmpDir,
        "docs/exec-plans/dead-brief.md",
        `---\nstatus: in-progress\nbrief: docs/briefs/ghost.md\n---\n\n- [ ] Task\n`
      );

      const result = await checkArtifacts(tmpDir, DEFAULT_PATHS);

      const problem = result.problems.find(
        (p) => p.type === "plan_brief_dead" && p.file.includes("dead-brief")
      );
      assert.notEqual(problem, undefined, "expected a plan_brief_dead problem");
      assert.equal(problem.severity, "blocking");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("brief: missing exec_plan field → warning brief_missing_plan", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-checkArtifacts-"));
    try {
      await writeFile(
        tmpDir,
        "docs/briefs/no-plan.md",
        `---\nproject: some-project\n---\n\n# Brief without exec_plan\n`
      );

      const result = await checkArtifacts(tmpDir, DEFAULT_PATHS);

      const problem = result.problems.find(
        (p) => p.type === "brief_missing_plan" && p.file.includes("no-plan")
      );
      assert.notEqual(problem, undefined, "expected a brief_missing_plan problem");
      assert.equal(problem.severity, "warning");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("spec: status draft, created 40 days ago → warning spec_stale_draft", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-checkArtifacts-"));
    try {
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      await writeFile(
        tmpDir,
        "docs/specs/old-draft.md",
        `---\ntitle: "Old Draft"\nstatus: draft\ncreated: ${fortyDaysAgo}\n---\n\n# Old Draft\n`
      );

      const result = await checkArtifacts(tmpDir, DEFAULT_PATHS);

      const problem = result.problems.find(
        (p) => p.type === "spec_stale_draft" && p.file.includes("old-draft")
      );
      assert.notEqual(problem, undefined, "expected a spec_stale_draft problem");
      assert.equal(problem.severity, "warning");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("spec: status draft, created today → no stale warning", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-checkArtifacts-"));
    try {
      const todayStr = new Date().toISOString().slice(0, 10);

      await writeFile(
        tmpDir,
        "docs/specs/fresh-draft.md",
        `---\ntitle: "Fresh Draft"\nstatus: draft\ncreated: ${todayStr}\n---\n\n# Fresh Draft\n`
      );

      const result = await checkArtifacts(tmpDir, DEFAULT_PATHS);

      const staleProblems = result.problems.filter(
        (p) => p.type === "spec_stale_draft" && p.file.includes("fresh-draft")
      );
      assert.equal(staleProblems.length, 0, "should not flag a spec created today as stale");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── runMechanicalChecks ────────────────────────────────────────────────────────

// NOTE: these AGENTS.md-sourced fixture commands intentionally avoid `node`
// (and any other interpreter) because interpreter invocations are rejected
// by the executeCheckCommand denylist as of the round-3 security hardening —
// `true`/`false` are real (non-shell-builtin) coreutils binaries that exit
// deterministically with 0/1 without touching anything on the denylist.
const NODE_EXIT_0 = "true";
const NODE_EXIT_1 = "false";

describe("runMechanicalChecks", () => {
  test("no AGENTS.md, no toolchain files → discovered: false, verdict: PASS", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-"));
    try {
      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.discovered, false);
      assert.equal(result.source, null);
      assert.equal(result.verdict, "PASS");
      assert.equal(result.gate, null);
      assert.deepEqual(result.lint, []);
      assert.deepEqual(result.test, []);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("AGENTS.md Review Checks — lint and test both pass → verdict PASS, source agents_md", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-"));
    try {
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `# Project\n\n## Review Checks\n\n### Lint\n- lint: ${NODE_EXIT_0}\n\n### Tests\n- test: ${NODE_EXIT_0}\n`
      );

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.discovered, true);
      assert.equal(result.source, "agents_md");
      assert.equal(result.verdict, "PASS");
      assert.equal(result.gate, null);
      assert.equal(result.lint.length, 1);
      assert.equal(result.lint[0].status, "PASSED");
      assert.equal(result.test.length, 1);
      assert.equal(result.test[0].status, "PASSED");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("AGENTS.md Review Checks — lint fails → verdict FAIL, gate lint, tests marked NOT_RUN and never executed", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-"));
    try {
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `## Review Checks\n\n### Lint\n- lint: ${NODE_EXIT_1}\n\n### Tests\n- test: ${NODE_EXIT_0}\n`
      );

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.verdict, "FAIL");
      assert.equal(result.gate, "lint");
      assert.equal(result.lint[0].status, "FAILED");
      assert.equal(result.test[0].status, "NOT_RUN");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("AGENTS.md Review Checks — multiple lint commands run exhaustively even after an earlier failure", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-"));
    try {
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `## Review Checks\n\n### Lint\n- lint: ${NODE_EXIT_1}\n- typecheck: ${NODE_EXIT_0}\n`
      );

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.verdict, "FAIL");
      assert.equal(result.gate, "lint");
      assert.equal(result.lint.length, 2);
      assert.equal(result.lint[0].status, "FAILED");
      assert.equal(result.lint[1].status, "PASSED");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("AGENTS.md Review Checks — test fails without on-failure override → verdict FAIL, gate test", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-"));
    try {
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `## Review Checks\n\n### Tests\n- test: ${NODE_EXIT_1}\n`
      );

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.verdict, "FAIL");
      assert.equal(result.gate, "test");
      assert.equal(result.test[0].status, "FAILED");
      assert.equal(result.test[0].blocking, true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("AGENTS.md Review Checks — test fails with on-failure: warn → verdict PASS, failure reported non-blocking", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-"));
    try {
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `## Review Checks\n\n### Tests\n- test: ${NODE_EXIT_1}\n  on-failure: warn\n`
      );

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.verdict, "PASS");
      assert.equal(result.gate, null);
      assert.equal(result.test[0].status, "FAILED");
      assert.equal(result.test[0].blocking, false);
      assert.equal(result.test[0].onFailure, "warn");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("command not found → status ERROR, does not block the verdict", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-"));
    try {
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `## Review Checks\n\n### Lint\n- lint: this-command-does-not-exist-xyz-12345\n`
      );

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.lint[0].status, "ERROR");
      assert.equal(result.verdict, "PASS");
      assert.equal(result.gate, null);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("toolchain auto-detection — package.json + package-lock.json with lint/test scripts, no AGENTS.md", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-"));
    try {
      await writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({ name: "fixture", scripts: { lint: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' } })
      );
      await writeFile(tmpDir, "package-lock.json", "{}");

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.discovered, true);
      assert.equal(result.source, "toolchain:npm");
      assert.equal(result.lint.length, 1);
      assert.equal(result.lint[0].command, "npm run lint");
      assert.equal(result.test.length, 1);
      assert.equal(result.test[0].command, "npm test");
      assert.equal(result.verdict, "PASS");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("AGENTS.md present but without a ## Review Checks section → falls through to toolchain detection", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-"));
    try {
      await writeFile(tmpDir, "AGENTS.md", "# Project\n\nJust some notes, no Review Checks section.\n");
      await writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({ name: "fixture", scripts: { lint: 'node -e "process.exit(0)"' } })
      );
      await writeFile(tmpDir, "package-lock.json", "{}");

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.source, "toolchain:npm");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Security regression: shell injection via AGENTS.md ─────────────────────

  test("SECURITY: AGENTS.md command with shell metacharacters has no shell side-effect (no injection)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-injection-"));
    const markerFile = join(tmpDir, "injection-marker");
    try {
      // A hostile AGENTS.md check command trying to piggyback a second command
      // via a shell metacharacter. If shell:true were still in use, this would
      // create `markerFile`. With shell:false + tokenization, `;`, `touch`, and
      // the path are all just literal argv tokens passed to the (nonexistent)
      // binary `echo` — no shell ever parses the `;`.
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `## Review Checks\n\n### Lint\n- lint: echo hi ; touch ${markerFile}\n`
      );

      const result = await runMechanicalChecks(tmpDir);

      // The marker file must NOT have been created — proves no shell ever
      // interpreted the `;` as a command separator.
      assert.equal(existsSync(markerFile), false, "shell metacharacter must not have side effects");

      // "echo" runs directly with argv ["hi", ";", "touch", markerFile] as
      // literal arguments — it exits 0, so the check PASSES (its output
      // literally contains the semicolon and "touch" as inert text).
      assert.equal(result.lint[0].status, "PASSED");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("SECURITY: executeCheckCommand passes shell metacharacters as literal argv, not to a shell", () => {
    const tmpDir_ = tmpdir();
    const { status, output } = executeCheckCommand(tmpDir_, 'echo safe && echo also-safe; echo done');

    // Under shell:false, "echo" receives argv ["safe", "&&", "echo", "also-safe;", "echo", "done"]
    // as literal strings — it just echoes them back verbatim, it never chains commands.
    assert.equal(status, "PASSED");
    assert.equal(output, "");
  });

  // ── Timeout handling ─────────────────────────────────────────────────────────

  test("command exceeding timeout → status TIMEOUT, does not hang the process", () => {
    const tmpDir_ = tmpdir();
    const { status, output } = executeCheckCommand(tmpDir_, "sleep 5", { timeoutMs: 100 });

    assert.equal(status, "TIMEOUT");
    assert.match(output, /timed out/i);
  });

  test("runMechanicalChecks: a lint command that times out blocks the verdict with gate lint", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-timeout-"));
    try {
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `## Review Checks\n\n### Lint\n- lint: sleep 5\n`
      );

      // Override the default 120s timeout with a short one so the test stays
      // fast and deterministic instead of actually waiting on `sleep 5`.
      const result = await runMechanicalChecks(tmpDir, { timeoutMs: 50 });

      assert.equal(result.lint[0].status, "TIMEOUT");
      assert.equal(result.verdict, "FAIL");
      assert.equal(result.gate, "lint");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Exit code 126 (permission denied) ───────────────────────────────────────

  test("exit code 126 (permission denied / not executable) → status ERROR, same as 127", () => {
    const tmpDir_ = tmpdir();
    // `sh -c "exit 126"` deterministically produces exit code 126 without
    // needing to create and chmod a real non-executable file on disk. This
    // test exercises the exit-code-mapping logic specifically, not the
    // security denylist (covered separately below), so it passes
    // `trusted: true` to bypass the (correct, intentional) denylist rejection
    // of `sh` as an AGENTS.md-sourced command.
    const { status } = executeCheckCommand(tmpDir_, "sh -c \"exit 126\"", { trusted: true });

    assert.equal(status, "ERROR");
  });

  // ── Output truncation (head+tail) ───────────────────────────────────────────

  test("truncateOutput: output with more than 50 lines keeps head and tail, omits middle", () => {
    const lines = [];
    for (let i = 1; i <= 100; i++) lines.push(`line-${i}`);
    const text = lines.join("\n");

    const result = truncateOutput(text);

    // First 10 lines preserved verbatim.
    assert.match(result, /^line-1\n/);
    assert.match(result, /line-10\n/);
    // Last 40 lines preserved verbatim (line-61 .. line-100).
    assert.match(result, /line-61/);
    assert.match(result, /line-100$/);
    // Omission marker present, mentioning the omitted count (100 - 10 - 40 = 50).
    assert.match(result, /\(50 lines omitted\)/);
    // Middle lines (e.g. line-50) must NOT be present.
    assert.doesNotMatch(result, /\bline-50\b/);
  });

  test("truncateOutput: output with 50 lines or fewer is returned unchanged (no marker)", () => {
    const lines = [];
    for (let i = 1; i <= 50; i++) lines.push(`line-${i}`);
    const text = lines.join("\n");

    const result = truncateOutput(text);

    assert.equal(result, text);
    assert.doesNotMatch(result, /omitted/);
  });

  // ── Toolchain auto-detection: additional package managers / languages ──────

  test("toolchain auto-detection — pnpm-lock.yaml", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-pnpm-"));
    try {
      await writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({ name: "fixture", scripts: { lint: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' } })
      );
      await writeFile(tmpDir, "pnpm-lock.yaml", "");

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.source, "toolchain:pnpm");
      assert.equal(result.lint[0].command, "pnpm run lint");
      assert.equal(result.test[0].command, "pnpm test");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("toolchain auto-detection — yarn.lock", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-yarn-"));
    try {
      await writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({ name: "fixture", scripts: { test: 'node -e "process.exit(0)"' } })
      );
      await writeFile(tmpDir, "yarn.lock", "");

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.source, "toolchain:yarn");
      assert.equal(result.test[0].command, "yarn test");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("toolchain auto-detection — bun.lockb", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-bun-"));
    try {
      await writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({ name: "fixture", scripts: { test: 'node -e "process.exit(0)"' } })
      );
      await writeFile(tmpDir, "bun.lockb", "");

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.source, "toolchain:bun");
      assert.equal(result.test[0].command, "bun test");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("toolchain auto-detection — Cargo.toml (cargo)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-cargo-"));
    try {
      await writeFile(tmpDir, "Cargo.toml", "[package]\nname = \"fixture\"\n");

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.source, "toolchain:cargo");
      assert.equal(result.lint[0].command, "cargo clippy");
      assert.equal(result.test[0].command, "cargo test");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("toolchain auto-detection — go.mod (go)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-go-"));
    try {
      await writeFile(tmpDir, "go.mod", "module fixture\n\ngo 1.22\n");

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.source, "toolchain:go");
      assert.equal(result.lint[0].command, "go vet ./...");
      assert.equal(result.test[0].command, "go test ./...");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("toolchain auto-detection — pyproject.toml + uv.lock (uv)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-uv-"));
    try {
      await writeFile(tmpDir, "pyproject.toml", "[project]\nname = \"fixture\"\n");
      await writeFile(tmpDir, "uv.lock", "");

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.source, "toolchain:uv");
      assert.equal(result.lint[0].command, "uv run ruff check .");
      assert.equal(result.test[0].command, "uv run pytest");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("toolchain auto-detection — pyproject.toml without uv.lock (poetry)", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-poetry-"));
    try {
      await writeFile(tmpDir, "pyproject.toml", "[tool.poetry]\nname = \"fixture\"\n");

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.source, "toolchain:poetry");
      assert.equal(result.lint[0].command, "ruff check .");
      assert.equal(result.test[0].command, "pytest");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("toolchain auto-detection — Makefile", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-make-"));
    try {
      await writeFile(tmpDir, "Makefile", "lint:\n\ttrue\ntest:\n\ttrue\n");

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.source, "toolchain:make");
      assert.equal(result.lint[0].command, "make lint");
      assert.equal(result.test[0].command, "make test");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── SECURITY (round 3): interpreter/shell denylist ──────────────────────────
  // Round 2 review proved shell:false + tokenization alone is insufficient:
  // `bash -c "<payload>"` tokenizes cleanly and still executes the payload
  // because bash itself interprets its `-c` argument. These tests prove the
  // round-3 denylist closes that gap.

  test("SECURITY REGRESSION: AGENTS.md 'bash -c \"touch <marker>\"' is rejected, marker file is NOT created", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-bash-bypass-"));
    const markerFile = join(tmpDir, "bash-bypass-marker");
    try {
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `## Review Checks\n\n### Lint\n- lint: bash -c "touch ${markerFile}"\n`
      );

      const result = await runMechanicalChecks(tmpDir);

      // This is the critical assertion: before the round-3 fix, bash would
      // actually run and create this file even though shell:false was in use,
      // because bash -c itself interprets its own argument as a script.
      assert.equal(existsSync(markerFile), false, "bash -c payload must NOT have executed");
      assert.equal(result.lint[0].status, "REJECTED");
      assert.notEqual(result.lint[0].status, "PASSED");
      assert.equal(result.verdict, "FAIL");
      assert.equal(result.gate, "lint");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("SECURITY REGRESSION: AGENTS.md 'sh -c \"touch <marker>\"' is rejected, marker file is NOT created", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-sh-bypass-"));
    const markerFile = join(tmpDir, "sh-bypass-marker");
    try {
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `## Review Checks\n\n### Lint\n- lint: sh -c "touch ${markerFile}"\n`
      );

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(existsSync(markerFile), false, "sh -c payload must NOT have executed");
      assert.equal(result.lint[0].status, "REJECTED");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("SECURITY: python3 -c \"...\" is denylisted", () => {
    const { status, output } = executeCheckCommand(tmpdir(), 'python3 -c "print(1)"');
    assert.equal(status, "REJECTED");
    assert.match(output, /not permitted/i);
  });

  test("SECURITY: node -e \"...\" is denylisted (untrusted path)", () => {
    const { status, output } = executeCheckCommand(tmpdir(), 'node -e "console.log(1)"');
    assert.equal(status, "REJECTED");
    assert.match(output, /not permitted/i);
  });

  test("SECURITY: perl -e \"...\" is denylisted", () => {
    const { status } = executeCheckCommand(tmpdir(), 'perl -e "print 1"');
    assert.equal(status, "REJECTED");
  });

  test("SECURITY: a binary referenced by absolute path (e.g. /tmp/evil) is rejected", () => {
    const { status, output } = executeCheckCommand(tmpdir(), "/tmp/evil --do-bad-things");
    assert.equal(status, "REJECTED");
    assert.match(output, /not permitted/i);
  });

  test("SECURITY: a binary referenced by relative path (e.g. ./evil) is rejected", () => {
    const { status } = executeCheckCommand(tmpdir(), "./evil");
    assert.equal(status, "REJECTED");
  });

  test("happy path regression: legitimate AGENTS.md commands (eslint, npm test) are NOT rejected by the denylist", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-happy-"));
    try {
      // `eslint` and `npm` are not interpreters and have no path separator,
      // so they must sail through the denylist untouched (they'll fail with
      // ERROR/ENOENT in this sandbox since they're not installed — the point
      // is that failure must come from "not found", never from "REJECTED").
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `## Review Checks\n\n### Lint\n- lint: eslint .\n\n### Tests\n- test: npm test\n`
      );

      const result = await runMechanicalChecks(tmpDir);

      assert.notEqual(result.lint[0].status, "REJECTED");
      assert.notEqual(result.test[0].status, "REJECTED");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("toolchain auto-detection — bun.lockb: internal 'bun test' usage is trusted and not rejected by the denylist", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-bun-trusted-"));
    try {
      await writeFile(
        tmpDir,
        "package.json",
        JSON.stringify({ name: "fixture", scripts: { test: "true" } })
      );
      await writeFile(tmpDir, "bun.lockb", "");

      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.source, "toolchain:bun");
      assert.equal(result.test[0].command, "bun test");
      // `bun` is on the interpreter denylist (bun -e runs arbitrary JS like
      // node -e), but this is an internally hardcoded toolchain command, not
      // AGENTS.md-sourced input, so it must be trusted and not rejected —
      // it should fail with ERROR (bun not installed / ENOENT in CI) rather
      // than REJECTED.
      assert.notEqual(result.test[0].status, "REJECTED");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── ENOBUFS / maxBuffer overflow ─────────────────────────────────────────────

  test("executeCheckCommand: output exceeding maxBuffer → status ERROR, message mentions maxBuffer", () => {
    // Use `find` against a directory... no — `find` is denylisted (find -exec).
    // `printf` is not an interpreter and is allowlist-safe; it can be asked to
    // repeat a long string to blow past a tiny maxBuffer deterministically and
    // fast, without needing to invoke any denylisted interpreter.
    const tmpDir_ = tmpdir();
    const bigArg = "x".repeat(1000);
    const { status, output } = executeCheckCommand(tmpDir_, `printf ${bigArg}`, { maxBuffer: 100 });

    assert.equal(status, "ERROR");
    assert.match(output, /maxBuffer/i);
  });

  // ── Malformed command: unterminated quote ───────────────────────────────────

  test("executeCheckCommand: unterminated quote in command string → status ERROR, 'malformed command'", () => {
    const tmpDir_ = tmpdir();
    // Simulates a typo'd AGENTS.md entry like `eslint "src --fix` (missing
    // closing double-quote).
    const { status, output } = executeCheckCommand(tmpDir_, 'eslint "src --fix');

    assert.equal(status, "ERROR");
    assert.match(output, /malformed command/i);
    assert.match(output, /unterminated quote/i);
  });

  test("runMechanicalChecks: AGENTS.md command with unterminated quote is handled gracefully, does not crash", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-mech-badquote-"));
    try {
      await writeFile(
        tmpDir,
        "AGENTS.md",
        `## Review Checks\n\n### Lint\n- lint: eslint "src --fix\n`
      );

      // The key assertion is that this does NOT throw / crash the pre-filter.
      // ERROR is non-blocking by this codebase's existing convention (see the
      // "command not found" test above: an unusable check is "absent", not
      // "failed") — a malformed command is likewise unusable, so it's reported
      // as ERROR with a clear message rather than silently PASSED or crashing.
      const result = await runMechanicalChecks(tmpDir);

      assert.equal(result.lint[0].status, "ERROR");
      assert.match(result.lint[0].output, /malformed command/i);
      assert.equal(result.verdict, "PASS");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("splitCommandLine: throws on unterminated quote", () => {
    assert.throws(() => splitCommandLine('eslint "src --fix'), /unterminated quote/i);
  });

  test("splitCommandLine: well-formed quoted command still tokenizes correctly (no false positive)", () => {
    assert.deepEqual(splitCommandLine('npm run "test:unit"'), ["npm", "run", "test:unit"]);
  });
});
