import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mergePermissionSets } from '../dist/runtime/permissions.js';

describe('mergePermissionSets', () => {
  test('returns empty object when both inputs are empty', () => {
    const result = mergePermissionSets({}, {});
    assert.deepStrictEqual(result, {});
  });

  test('returns only deny when child has no allowed tools and parent has deny', () => {
    const parent = { allow: ['read'], deny: ['bash'] };
    const result = mergePermissionSets(parent, {});
    assert.deepStrictEqual(result, { deny: ['bash'] });
  });

  test('filters child allow list to only tools parent also allows', () => {
    const parent = { allow: ['read', 'write'] };
    const child = { allow: ['read', 'execute'] };
    const result = mergePermissionSets(parent, child);
    assert.deepStrictEqual(result.allow, ['read']);
  });

  test('preserves deny entries from both parent and child', () => {
    const parent = { allow: ['read'], deny: ['bash'] };
    const child = { allow: ['read'], deny: ['curl'] };
    const result = mergePermissionSets(parent, child);
    assert.ok(result.deny);
    assert.ok(result.deny.includes('bash'));
    assert.ok(result.deny.includes('curl'));
  });

  test('deduplicates deny entries', () => {
    const parent = { allow: ['read'], deny: ['bash'] };
    const child = { allow: ['read'], deny: ['bash', 'curl'] };
    const result = mergePermissionSets(parent, child);
    assert.strictEqual(result.deny.length, 2);
    assert.ok(result.deny.includes('bash'));
    assert.ok(result.deny.includes('curl'));
  });

  test('returns empty when child allows nothing parent allows', () => {
    const parent = { allow: ['read'] };
    const child = { allow: ['execute'] };
    const result = mergePermissionSets(parent, child);
    assert.ok(!result.allow);
  });

  test('merges allow_paths for tools present in parent allow', () => {
    const parent = { allow: ['read'], allow_paths: { read: ['src/**'] } };
    const child = { allow: ['read'], allow_paths: { read: ['src/**', 'docs/**'] } };
    const result = mergePermissionSets(parent, child);
    assert.deepStrictEqual(result.allow_paths, { read: ['src/**'] });
  });

  test('includes child allow_paths when parent has no paths for that tool', () => {
    const parent = { allow: ['read'] };
    const child = { allow: ['read'], allow_paths: { read: ['src/**', 'docs/**'] } };
    const result = mergePermissionSets(parent, child);
    assert.deepStrictEqual(result.allow_paths, { read: ['src/**', 'docs/**'] });
  });

  test('skips allow_paths for tools not in parent allowed set', () => {
    const parent = { allow: ['read'] };
    const child = { allow: ['read', 'write'], allow_paths: { write: ['src/**'] } };
    const result = mergePermissionSets(parent, child);
    assert.ok(!result.allow_paths);
  });

  test('copies parent allow_paths when child does not specify them', () => {
    const parent = { allow: ['read'], allow_paths: { read: ['src/**'] } };
    const child = { allow: ['read'] };
    const result = mergePermissionSets(parent, child);
    assert.deepStrictEqual(result.allow_paths, { read: ['src/**'] });
  });

  test('merges allow_commands with intersection logic', () => {
    const parent = { allow: ['execute'], allow_commands: { execute: ['npm test'] } };
    const child = { allow: ['execute'], allow_commands: { execute: ['npm test', 'npm run lint'] } };
    const result = mergePermissionSets(parent, child);
    assert.deepStrictEqual(result.allow_commands, { execute: ['npm test'] });
  });

  test('includes child allow_commands when parent has none for that tool', () => {
    const parent = { allow: ['execute'] };
    const child = { allow: ['execute'], allow_commands: { execute: ['npm test', 'npm run lint'] } };
    const result = mergePermissionSets(parent, child);
    assert.deepStrictEqual(result.allow_commands, { execute: ['npm test', 'npm run lint'] });
  });

  test('copies parent allow_commands when child does not specify them', () => {
    const parent = { allow: ['execute'], allow_commands: { execute: ['npm test'] } };
    const child = { allow: ['execute'] };
    const result = mergePermissionSets(parent, child);
    assert.deepStrictEqual(result.allow_commands, { execute: ['npm test'] });
  });

  test('does not include allow_commands for tools not in parent allow list', () => {
    const parent = { allow: ['read'] };
    const child = { allow: ['read', 'write'], allow_commands: { write: ['rm -rf /'] } };
    const result = mergePermissionSets(parent, child);
    assert.ok(!result.allow_commands);
  });

  test('handles allow_paths with no parent paths but child has paths for allowed tool', () => {
    const parent = { allow: ['read'] };
    const child = { allow: ['read'], allow_paths: { read: ['src/**'] } };
    const result = mergePermissionSets(parent, child);
    assert.deepStrictEqual(result.allow_paths, { read: ['src/**'] });
  });

  test('handles allow_paths intersection when both parent and child have paths', () => {
    const parent = { allow: ['read'], allow_paths: { read: ['src/**', 'docs/**'] } };
    const child = { allow: ['read'], allow_paths: { read: ['src/**', 'tests/**'] } };
    const result = mergePermissionSets(parent, child);
    assert.deepStrictEqual(result.allow_paths, { read: ['src/**'] });
  });

  test('includes deny when parent has deny and child is empty', () => {
    const parent = { deny: ['bash'] };
    const result = mergePermissionSets(parent, {});
    assert.deepStrictEqual(result, { deny: ['bash'] });
  });

  test('includes deny in result even when no allowed tools are present', () => {
    const parent = { deny: ['bash'] };
    const child = { deny: ['curl'] };
    const result = mergePermissionSets(parent, child);
    assert.ok(result.deny);
    assert.strictEqual(result.deny.length, 2);
  });

  test('does not include allow_paths when child paths are empty after intersection', () => {
    const parent = { allow: ['read'], allow_paths: { read: ['src/**'] } };
    const child = { allow: ['read'], allow_paths: { read: ['docs/**'] } };
    const result = mergePermissionSets(parent, child);
    assert.ok(!result.allow_paths);
  });

  test('does not include allow_commands when child commands are empty after intersection', () => {
    const parent = { allow: ['execute'], allow_commands: { execute: ['npm test'] } };
    const child = { allow: ['execute'], allow_commands: { execute: ['cargo test'] } };
    const result = mergePermissionSets(parent, child);
    assert.ok(!result.allow_commands);
  });
});
