import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  checkDoomLoop,
  resetDoomLoop,
  buildToolsMap,
  buildHostPermission,
  evaluatePermission,
  buildPermissionContext,
} from '../dist/plugin/agents.js';

describe('checkDoomLoop', () => {
  test('returns false on first call with unique session/tool', () => {
    assert.strictEqual(checkDoomLoop('session-alpha', 'tool-a', 'arg1'), false);
  });

  test('returns false on second call with same args', () => {
    checkDoomLoop('session-beta', 'tool-b', 'arg1');
    assert.strictEqual(checkDoomLoop('session-beta', 'tool-b', 'arg1'), false);
  });

  test('returns true on third call with same args', () => {
    checkDoomLoop('session-gamma', 'tool-c', 'arg1');
    checkDoomLoop('session-gamma', 'tool-c', 'arg1');
    assert.strictEqual(checkDoomLoop('session-gamma', 'tool-c', 'arg1'), true);
  });

  test('returns false when args change', () => {
    checkDoomLoop('session-delta', 'tool-d', 'arg1');
    checkDoomLoop('session-delta', 'tool-d', 'arg2');
    assert.strictEqual(checkDoomLoop('session-delta', 'tool-d', 'arg2'), false);
  });

  test('tracks different sessions independently', () => {
    checkDoomLoop('session-1', 'tool-x', 'arg1');
    checkDoomLoop('session-1', 'tool-x', 'arg1');
    assert.strictEqual(checkDoomLoop('session-2', 'tool-x', 'arg1'), false);
  });

  test('tracks different tools independently', () => {
    checkDoomLoop('session-3', 'tool-p', 'arg1');
    checkDoomLoop('session-3', 'tool-p', 'arg1');
    assert.strictEqual(checkDoomLoop('session-3', 'tool-q', 'arg1'), false);
  });

  test('returns false after reset', () => {
    checkDoomLoop('session-4', 'tool-r', 'arg1');
    checkDoomLoop('session-4', 'tool-r', 'arg1');
    resetDoomLoop('session-4', 'tool-r');
    assert.strictEqual(checkDoomLoop('session-4', 'tool-r', 'arg1'), false);
  });

  test('handles undefined pattern', () => {
    assert.strictEqual(checkDoomLoop('session-5', 'tool-s'), false);
    assert.strictEqual(checkDoomLoop('session-5', 'tool-s'), false);
    assert.strictEqual(checkDoomLoop('session-5', 'tool-s'), true);
  });

  test('handles array pattern', () => {
    assert.strictEqual(checkDoomLoop('session-6', 'tool-t', ['a', 'b']), false);
    assert.strictEqual(checkDoomLoop('session-6', 'tool-t', ['a', 'b']), false);
    assert.strictEqual(checkDoomLoop('session-6', 'tool-t', ['a', 'b']), true);
  });

  test('returns false when args partially change', () => {
    checkDoomLoop('session-7', 'tool-u', ['a', 'b']);
    assert.strictEqual(checkDoomLoop('session-7', 'tool-u', ['a', 'c']), false);
  });
});

describe('buildToolsMap', () => {
  test('returns empty object for empty permission', () => {
    assert.deepStrictEqual(buildToolsMap({}), {});
  });

  test('maps allow values to true', () => {
    const result = buildToolsMap({ read: 'allow', write: 'allow' });
    assert.strictEqual(result.read, true);
    assert.strictEqual(result.write, true);
  });

  test('maps deny values to false for plugin tools', () => {
    const pluginTools = new Set(['bash']);
    const result = buildToolsMap({ read: 'allow', bash: 'deny' }, pluginTools);
    assert.strictEqual(result.read, true);
    assert.strictEqual(result.bash, false);
  });

  test('skips deny values for non-plugin tools', () => {
    const pluginTools = new Set(['bash']);
    const result = buildToolsMap({ read: 'allow', curl: 'deny' }, pluginTools);
    assert.strictEqual(result.read, true);
    assert.ok(!('curl' in result));
  });

  test('skips wildcard key', () => {
    const result = buildToolsMap({ '*': 'deny', read: 'allow' });
    assert.ok(!('*' in result));
    assert.strictEqual(result.read, true);
  });
});

describe('buildHostPermission', () => {
  test('passes through allow values', () => {
    const result = buildHostPermission({ read: 'allow', write: 'allow' });
    assert.strictEqual(result.read, 'allow');
    assert.strictEqual(result.write, 'allow');
  });

  test('skips deny values for non-plugin tools', () => {
    const pluginTools = new Set(['bash']);
    const result = buildHostPermission({ read: 'allow', curl: 'deny' }, pluginTools);
    assert.strictEqual(result.read, 'allow');
    assert.ok(!('curl' in result));
  });

  test('keeps deny values for plugin tools', () => {
    const pluginTools = new Set(['bash']);
    const result = buildHostPermission({ read: 'allow', bash: 'deny' }, pluginTools);
    assert.strictEqual(result.bash, 'deny');
  });

  test('sets edit to allow when write is allow and edit is missing', () => {
    const result = buildHostPermission({ write: 'allow' });
    assert.strictEqual(result.edit, 'allow');
  });

  test('does not override existing edit value', () => {
    const result = buildHostPermission({ write: 'allow', edit: 'deny' });
    assert.strictEqual(result.edit, 'deny');
  });

  test('sets external_directory to deny by default', () => {
    const result = buildHostPermission({});
    assert.strictEqual(result.external_directory, 'deny');
  });

  test('keeps existing external_directory value', () => {
    const result = buildHostPermission({ external_directory: 'allow' });
    assert.strictEqual(result.external_directory, 'allow');
  });

  test('passes through wildcard', () => {
    const result = buildHostPermission({ '*': 'deny', read: 'allow' });
    assert.strictEqual(result['*'], 'deny');
  });
});

describe('evaluatePermission', () => {
  test('returns deny for .env files', () => {
    assert.strictEqual(
      evaluatePermission({ read: 'allow' }, 'read', '.env'),
      'deny'
    );
  });

  test('returns deny for .env.example files', () => {
    assert.strictEqual(
      evaluatePermission({ read: 'allow' }, 'read', '.env.example'),
      'allow'
    );
  });

  test('returns deny for path ending with .env', () => {
    assert.strictEqual(
      evaluatePermission({ read: 'allow' }, 'read', 'config/.env'),
      'deny'
    );
  });

  test('returns deny for tool with undefined rule', () => {
    assert.strictEqual(
      evaluatePermission({ read: 'allow' }, 'execute'),
      'deny'
    );
  });

  test('returns deny for tool with deny rule', () => {
    assert.strictEqual(
      evaluatePermission({ read: 'allow', execute: 'deny' }, 'execute'),
      'deny'
    );
  });

  test('returns allow for tool with allow rule', () => {
    assert.strictEqual(
      evaluatePermission({ read: 'allow' }, 'read'),
      'allow'
    );
  });

  test('falls back to write rule for edit tool', () => {
    assert.strictEqual(
      evaluatePermission({ read: 'allow', write: 'allow' }, 'edit'),
      'allow'
    );
  });

  test('does not fall back to write when edit has explicit deny', () => {
    assert.strictEqual(
      evaluatePermission({ write: 'allow', edit: 'deny' }, 'edit'),
      'deny'
    );
  });

  test('returns deny for pattern rule with no pattern provided', () => {
    assert.strictEqual(
      evaluatePermission({ read: { 'src/**': 'allow' } }, 'read'),
      'deny'
    );
  });

  test('returns allow when single wildcard pattern matches', () => {
    assert.strictEqual(
      evaluatePermission({ read: { 'src/*': 'allow' } }, 'read', 'src/main.ts'),
      'allow'
    );
  });

  test('returns allow when multiple wildcard patterns each match independently', () => {
    assert.strictEqual(
      evaluatePermission({ read: { 'src/*': 'allow', 'docs/*': 'allow' } }, 'read', ['src/main.ts', 'docs/readme.md']),
      'allow'
    );
  });

  test('returns deny when any pattern does not match', () => {
    assert.strictEqual(
      evaluatePermission({ read: { 'src/*': 'allow' } }, 'read', ['src/main.ts', 'lib/util.ts']),
      'deny'
    );
  });

  test('returns allow for exact pattern match', () => {
    assert.strictEqual(
      evaluatePermission({ read: { 'package.json': 'allow' } }, 'read', 'package.json'),
      'allow'
    );
  });

  test('returns deny for non-matching exact pattern', () => {
    assert.strictEqual(
      evaluatePermission({ read: { 'package.json': 'deny' } }, 'read', 'other.json'),
      'deny'
    );
  });

  test('wildcard pattern matches prefix with trailing asterisk', () => {
    assert.strictEqual(
      evaluatePermission({ read: { 'src/': 'allow' } }, 'read', 'src/main.ts'),
      'deny'
    );
  });

  test('wildcard pattern does not match different prefix', () => {
    assert.strictEqual(
      evaluatePermission({ read: { 'src/': 'allow' } }, 'read', 'lib/main.ts'),
      'deny'
    );
  });

  test('star wildcard matches all paths', () => {
    assert.strictEqual(
      evaluatePermission({ read: { '*': 'allow' } }, 'read', 'anything'),
      'allow'
    );
  });
});

describe('buildPermissionContext', () => {
  test('returns deny-all when agent not found', () => {
    const result = buildPermissionContext('unknown', null, []);
    assert.deepStrictEqual(result, { '*': 'deny' });
  });

  test('returns merged permissions when agent is found', () => {
    const agents = [
      { id: 'agent-1', permission: { read: 'allow', write: 'deny' } },
    ];
    const result = buildPermissionContext('agent-1', null, agents);
    assert.strictEqual(result.read, 'allow');
    assert.strictEqual(result.write, 'deny');
  });

  test('merges overrides on top of agent permissions', () => {
    const agents = [
      { id: 'agent-1', permission: { read: 'allow', write: 'deny' } },
    ];
    const result = buildPermissionContext('agent-1', { write: 'allow' }, agents);
    assert.strictEqual(result.read, 'allow');
    assert.strictEqual(result.write, 'allow');
  });
});
