import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  truncateOutput,
  splitCommandLine,
  projectState,
  completePlan,
  markBlockDone,
  registerSpec,
  writeAppend,
  saveCheckpoint,
  checkArtifacts,
} from '../dist/tools/lifecycle.js';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('truncateOutput', () => {
  test('returns original text when under max lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const result = truncateOutput(lines);
    assert.strictEqual(result, lines);
  });

  test('returns original text trimmed when at exactly max lines', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const result = truncateOutput(lines);
    assert.strictEqual(result, lines);
  });

  test('truncates text over max lines without important lines', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
    const result = truncateOutput(lines);
    const omitted = 60 - 10 - 40; // HEAD_LINES + TAIL_LINES = 50, omitted = 10
    assert.ok(result.includes(`... (${omitted} lines omitted) ...`));
    assert.ok(result.startsWith('line 0\nline 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9'));
    assert.ok(result.includes('line 50\nline 51\nline 52\nline 53\nline 54\nline 55\nline 56\nline 57\nline 58\nline 59'));
  });

  test('includes important lines in truncated middle', () => {
    const lines = ['line 0', 'line 1', 'ERROR something bad', 'line 3', 'FAIL here', 'line 5'];
    const longInput = Array.from({ length: 55 }, (_, i) => lines[i % lines.length]).join('\n');
    const result = truncateOutput(longInput);
    assert.ok(result.includes('important lines'));
    assert.ok(result.includes('ERROR something bad'));
    assert.ok(result.includes('FAIL here'));
  });

  test('handles null/undefined input gracefully', () => {
    assert.strictEqual(truncateOutput(null), '');
    assert.strictEqual(truncateOutput(undefined), '');
  });

  test('handles empty string', () => {
    assert.strictEqual(truncateOutput(''), '');
  });

  test('normalizes CRLF to LF in output', () => {
    const lines = ['line 0', 'line 1', 'line 2'].join('\r\n');
    const result = truncateOutput(lines);
    assert.ok(!result.includes('\r'));
  });
});

describe('splitCommandLine', () => {
  test('splits simple space-separated command', () => {
    assert.deepStrictEqual(splitCommandLine('npm test'), ['npm', 'test']);
  });

  test('splits command with multiple spaces', () => {
    assert.deepStrictEqual(splitCommandLine('npm   run   build'), ['npm', 'run', 'build']);
  });

  test('preserves single-quoted strings', () => {
    assert.deepStrictEqual(splitCommandLine("echo 'hello world'"), ['echo', 'hello world']);
  });

  test('preserves double-quoted strings', () => {
    assert.deepStrictEqual(splitCommandLine('echo "hello world"'), ['echo', 'hello world']);
  });

  test('handles mixed quotes', () => {
    assert.deepStrictEqual(splitCommandLine("echo 'hello' \"world\""), ['echo', 'hello', 'world']);
  });

  test('skips empty quoted strings', () => {
    assert.deepStrictEqual(splitCommandLine("echo ''"), ['echo']);
  });

  test('handles quotes around single word', () => {
    assert.deepStrictEqual(splitCommandLine("echo 'hello'"), ['echo', 'hello']);
  });

  test('handles nested quotes inside double quotes', () => {
    assert.deepStrictEqual(splitCommandLine('echo "it\'s working"'), ['echo', "it's working"]);
  });

  test('throws on unterminated quote', () => {
    assert.throws(() => splitCommandLine("echo 'hello"), /unterminated quote/);
  });

  test('throws on unterminated double quote', () => {
    assert.throws(() => splitCommandLine('echo "hello'), /unterminated quote/);
  });

  test('returns single token for no spaces', () => {
    assert.deepStrictEqual(splitCommandLine('npm'), ['npm']);
  });

  test('returns empty array for empty string', () => {
    assert.deepStrictEqual(splitCommandLine(''), []);
  });

  test('handles tabs as whitespace', () => {
    assert.deepStrictEqual(splitCommandLine('npm\trun\tbuild'), ['npm', 'run', 'build']);
  });

  test('handles newlines as whitespace', () => {
    assert.deepStrictEqual(splitCommandLine('npm\nrun\nbuild'), ['npm', 'run', 'build']);
  });

  test('preserves special characters inside quotes', () => {
    assert.deepStrictEqual(splitCommandLine('echo "$HOME"'), ['echo', '$HOME']);
  });

  test('handles consecutive quoted segments', () => {
    assert.deepStrictEqual(splitCommandLine("echo 'a' 'b' 'c'"), ['echo', 'a', 'b', 'c']);
  });
});

describe('projectState (indirect parseFrontmatter + countBlocks)', () => {
  let tmpDir;

  test('returns empty arrays when no markdown files exist', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    const result = await projectState(tmpDir, {
      specs: 'specs',
      execPlans: 'plans',
      briefs: 'briefs',
    });
    assert.deepStrictEqual(result.specs, []);
    assert.deepStrictEqual(result.exec_plans, []);
    assert.deepStrictEqual(result.briefs, []);
  });

  test('parses frontmatter fields from spec files', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'specs'), { recursive: true });
    await writeFile(
      join(tmpDir, 'specs', 'auth.md'),
      '---\ntitle: "Auth"\nid: SPEC-001\nstatus: active\ncreated: 2024-01-01\n---\n# Auth\n'
    );
    const result = await projectState(tmpDir, {
      specs: 'specs',
      execPlans: 'plans',
      briefs: 'briefs',
    });
    assert.strictEqual(result.specs.length, 1);
    assert.strictEqual(result.specs[0].title, 'Auth');
    assert.strictEqual(result.specs[0].id, 'SPEC-001');
    assert.strictEqual(result.specs[0].status, 'active');
    assert.strictEqual(result.specs[0].created, '2024-01-01');
  });

  test('parses checked/unchecked blocks from exec-plans', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'plans'), { recursive: true });
    await writeFile(
      join(tmpDir, 'plans', 'plan.md'),
      '---\nstatus: active\n---\n- [x] Implement login\n- [ ] Write tests\n- [x] Code review\n'
    );
    const result = await projectState(tmpDir, {
      specs: 'specs',
      execPlans: 'plans',
      briefs: 'briefs',
    });
    assert.strictEqual(result.exec_plans.length, 1);
    assert.strictEqual(result.exec_plans[0].blocks.total, 3);
    assert.strictEqual(result.exec_plans[0].blocks.checked, 2);
  });

  test('returns null for missing frontmatter fields', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'specs'), { recursive: true });
    await writeFile(join(tmpDir, 'specs', 'plain.md'), '# No frontmatter\n');
    const result = await projectState(tmpDir, {
      specs: 'specs',
      execPlans: 'plans',
      briefs: 'briefs',
    });
    assert.strictEqual(result.specs[0].title, null);
    assert.strictEqual(result.specs[0].id, null);
    assert.strictEqual(result.specs[0].status, null);
  });
});

describe('completePlan', () => {
  let tmpDir;

  test('completes a plan with all blocks checked', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'plans'), { recursive: true });
    await writeFile(
      join(tmpDir, 'plans', 'plan.md'),
      '---\nstatus: active\n---\n- [x] Task 1\n- [x] Task 2\n'
    );
    const result = await completePlan(tmpDir, 'plans/plan.md');
    assert.strictEqual(result.status, 'completed');
    assert.ok(result.updated);
  });

  test('throws when blocks are unchecked', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'plans'), { recursive: true });
    await writeFile(
      join(tmpDir, 'plans', 'plan.md'),
      '---\nstatus: active\n---\n- [x] Task 1\n- [ ] Task 2\n'
    );
    await assert.rejects(
      async () => completePlan(tmpDir, 'plans/plan.md'),
      /unchecked block/
    );
  });

  test('throws when status field is missing', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'plans'), { recursive: true });
    await writeFile(
      join(tmpDir, 'plans', 'plan.md'),
      '---\n---\n- [x] Task 1\n'
    );
    await assert.rejects(
      async () => completePlan(tmpDir, 'plans/plan.md'),
      /Field 'status' missing/
    );
  });

  test('throws when frontmatter is missing', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'plans'), { recursive: true });
    await writeFile(join(tmpDir, 'plans', 'plan.md'), '# No frontmatter\n');
    await assert.rejects(
      async () => completePlan(tmpDir, 'plans/plan.md'),
      /Frontmatter missing/
    );
  });
});

describe('markBlockDone', () => {
  let tmpDir;

  test('marks unchecked block as done', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'plans'), { recursive: true });
    await writeFile(
      join(tmpDir, 'plans', 'plan.md'),
      '---\nstatus: active\n---\n- [ ] Task 1\n- [ ] Task 2\n'
    );
    const result = await markBlockDone(tmpDir, 'plans/plan.md', 'Task 1');
    assert.strictEqual(result.was, 'unchecked');
    assert.strictEqual(result.now, 'checked');
    assert.strictEqual(result.blocks.total, 2);
    assert.strictEqual(result.blocks.checked, 1);
  });

  test('marks already checked block without changing count', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'plans'), { recursive: true });
    await writeFile(
      join(tmpDir, 'plans', 'plan.md'),
      '---\nstatus: active\n---\n- [x] Task 1\n- [ ] Task 2\n'
    );
    const result = await markBlockDone(tmpDir, 'plans/plan.md', 'Task 1');
    assert.strictEqual(result.was, 'checked');
    assert.strictEqual(result.blocks.checked, 1);
  });

  test('returns hint when all blocks are done', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'plans'), { recursive: true });
    await writeFile(
      join(tmpDir, 'plans', 'plan.md'),
      '---\nstatus: active\n---\n- [ ] Task 1\n'
    );
    const result = await markBlockDone(tmpDir, 'plans/plan.md', 'Task 1');
    assert.ok(result.hint);
    assert.ok(result.hint.includes('complete_plan'));
    assert.strictEqual(result.all_done, true);
  });

  test('throws when block is not found', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'plans'), { recursive: true });
    await writeFile(
      join(tmpDir, 'plans', 'plan.md'),
      '---\nstatus: active\n---\n- [ ] Task 1\n'
    );
    await assert.rejects(
      async () => markBlockDone(tmpDir, 'plans/plan.md', 'Nonexistent'),
      /Block "Nonexistent" not found/
    );
  });
});

describe('registerSpec', () => {
  let tmpDir;

  test('creates a new spec file with correct frontmatter', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'specs'), { recursive: true });
    const result = await registerSpec(tmpDir, { specs: 'specs' }, 'new-spec.md', 'My Spec');
    assert.strictEqual(result.created, true);
    assert.strictEqual(result.file, 'specs/new-spec.md');
  });

  test('throws when spec file already exists', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'specs'), { recursive: true });
    await registerSpec(tmpDir, { specs: 'specs' }, 'existing.md', 'My Spec');
    await assert.rejects(
      async () => registerSpec(tmpDir, { specs: 'specs' }, 'existing.md', 'My Spec'),
      /already exists/
    );
  });
});

describe('writeAppend', () => {
  let tmpDir;

  test('creates new file with content', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    const result = await writeAppend(tmpDir, 'notes.md', 'Hello world');
    assert.ok(result.file);
    assert.ok(result.bytes > 0);
  });

  test('appends to existing file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await writeAppend(tmpDir, 'notes.md', 'First line\n');
    const result = await writeAppend(tmpDir, 'notes.md', 'Second line');
    assert.ok(result.bytes > 12);
  });
});

describe('saveCheckpoint', () => {
  let tmpDir;

  test('creates a checkpoint file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    const result = await saveCheckpoint(tmpDir, 'checkpoints/resume.md', 'Summary here', 'Work remaining');
    assert.strictEqual(result.file, 'checkpoints/resume.md');
    assert.ok(result.bytes > 0);
  });
});

describe('checkArtifacts', () => {
  let tmpDir;

  test('returns consistent status when no artifacts exist', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'plans'), { recursive: true });
    await mkdir(join(tmpDir, 'briefs'), { recursive: true });
    await mkdir(join(tmpDir, 'specs'), { recursive: true });
    const result = await checkArtifacts(tmpDir, {
      specs: 'specs',
      execPlans: 'plans',
      briefs: 'briefs',
    });
    assert.strictEqual(result.problems.length, 0);
    assert.strictEqual(result.summary, 'All artifacts are consistent.');
  });

  test('detects stale draft specs older than 30 days', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'tori-test-'));
    await mkdir(join(tmpDir, 'specs'), { recursive: true });
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await writeFile(
      join(tmpDir, 'specs', 'old.md'),
      `---\ntitle: "Old"\nstatus: draft\ncreated: ${oldDate}\n---\n# Old\n`
    );
    const result = await checkArtifacts(tmpDir, {
      specs: 'specs',
      execPlans: 'plans',
      briefs: 'briefs',
    });
    const staleDraft = result.problems.find((p) => p.type === 'spec_stale_draft');
    assert.ok(staleDraft);
    assert.strictEqual(staleDraft.severity, 'warning');
  });
});
