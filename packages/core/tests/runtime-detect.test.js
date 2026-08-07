import { test, describe } from 'node:test';
import assert from 'node:assert';
import { detectRuntime } from '../dist/runtime/detect.js';

describe('detectRuntime', () => {
  test('returns opencode when TORI_RUNTIME is set to opencode', () => {
    const original = process.env.TORI_RUNTIME;
    process.env.TORI_RUNTIME = 'opencode';
    assert.strictEqual(detectRuntime(), 'opencode');
    if (original === undefined) {
      delete process.env.TORI_RUNTIME;
    } else {
      process.env.TORI_RUNTIME = original;
    }
  });

  test('returns kilocode when TORI_RUNTIME is set to kilocode', () => {
    const original = process.env.TORI_RUNTIME;
    process.env.TORI_RUNTIME = 'kilocode';
    assert.strictEqual(detectRuntime(), 'kilocode');
    if (original === undefined) {
      delete process.env.TORI_RUNTIME;
    } else {
      process.env.TORI_RUNTIME = original;
    }
  });

  test('ignores invalid TORI_RUNTIME values', () => {
    const original = process.env.TORI_RUNTIME;
    process.env.TORI_RUNTIME = 'invalid';
    // Should fall through to heuristic, which may return opencode or kilocode
    const result = detectRuntime();
    assert.ok(result === 'opencode' || result === 'kilocode');
    if (original === undefined) {
      delete process.env.TORI_RUNTIME;
    } else {
      process.env.TORI_RUNTIME = original;
    }
  });

  test('defaults to opencode when no env or heuristic matches', () => {
    const originalEnv = process.env.TORI_RUNTIME;
    const originalArgv = process.argv;
    process.env.TORI_RUNTIME = undefined;
    process.argv = ['node', 'some-script'];
    assert.strictEqual(detectRuntime(), 'opencode');
    if (originalEnv === undefined) {
      delete process.env.TORI_RUNTIME;
    } else {
      process.env.TORI_RUNTIME = originalEnv;
    }
    process.argv = originalArgv;
  });

  test('detects opencode from process.argv', () => {
    const originalEnv = process.env.TORI_RUNTIME;
    const originalArgv = process.argv;
    process.env.TORI_RUNTIME = undefined;
    process.argv = ['node', '/path/to/opencode', 'arg'];
    assert.strictEqual(detectRuntime(), 'opencode');
    if (originalEnv === undefined) {
      delete process.env.TORI_RUNTIME;
    } else {
      process.env.TORI_RUNTIME = originalEnv;
    }
    process.argv = originalArgv;
  });

  test('detects kilocode from process.argv', () => {
    const originalEnv = process.env.TORI_RUNTIME;
    const originalArgv = process.argv;
    process.env.TORI_RUNTIME = undefined;
    process.argv = ['node', '/path/to/kilocode', 'arg'];
    assert.strictEqual(detectRuntime(), 'kilocode');
    if (originalEnv === undefined) {
      delete process.env.TORI_RUNTIME;
    } else {
      process.env.TORI_RUNTIME = originalEnv;
    }
    process.argv = originalArgv;
  });

  test('env var takes precedence over heuristic', () => {
    const originalEnv = process.env.TORI_RUNTIME;
    const originalArgv = process.argv;
    process.env.TORI_RUNTIME = 'kilocode';
    process.argv = ['node', '/path/to/opencode', 'arg'];
    assert.strictEqual(detectRuntime(), 'kilocode');
    if (originalEnv === undefined) {
      delete process.env.TORI_RUNTIME;
    } else {
      process.env.TORI_RUNTIME = originalEnv;
    }
    process.argv = originalArgv;
  });
});
