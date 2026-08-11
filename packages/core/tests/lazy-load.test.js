import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  registerLazyTool,
  getLazyTool,
  getAllLazyTools,
  listLazyTools,
  loadLazyTool,
  buildDiscoveryTools,
  createLazyToolWrapper,
} from '../dist/plugin/lazy-load.js';

describe('lazy-load registry', () => {
  test('registerLazyTool stores a tool', () => {
    registerLazyTool({
      name: 'test_tool',
      category: 'core',
      description: 'A test tool',
      args: { foo: {} },
      execute: async () => 'ok',
    });
    const tool = getLazyTool('test_tool');
    assert.ok(tool);
    assert.strictEqual(tool.name, 'test_tool');
    assert.strictEqual(tool.category, 'core');
    assert.strictEqual(tool.description, 'A test tool');
  });

  test('getLazyTool returns undefined for unknown tool', () => {
    assert.strictEqual(getLazyTool('nonexistent'), undefined);
  });

  test('getAllLazyTools returns all registered tools', () => {
    const all = getAllLazyTools();
    const names = all.map(t => t.name);
    assert.ok(names.includes('test_tool'));
  });

  test('listLazyTools returns lightweight pointers', () => {
    const pointers = listLazyTools();
    const pointer = pointers.find(p => p.name === 'test_tool');
    assert.ok(pointer);
    assert.strictEqual(pointer.category, 'core');
    assert.strictEqual(pointer.loaded, false);
    assert.ok(!pointer.description); // no description in pointer
  });

  test('loadLazyTool returns full definition', async () => {
    const full = await loadLazyTool('test_tool');
    assert.strictEqual(full.name, 'test_tool');
    assert.strictEqual(full.category, 'core');
    assert.strictEqual(full.description, 'A test tool');
    assert.ok(full.args);
    assert.strictEqual(full.loaded, true);
  });

  test('loadLazyTool throws for unknown tool', async () => {
    await assert.rejects(
      async () => loadLazyTool('nonexistent'),
      /Tool not found: nonexistent/
    );
  });
});

describe('buildDiscoveryTools', () => {
  test('returns list_available_tools and load_tool', () => {
    const tools = buildDiscoveryTools();
    assert.ok(tools['list_available_tools']);
    assert.ok(tools['load_tool']);
  });

  test('list_available_tools returns registry contents', async () => {
    // Register a tool first so the registry isn't empty
    registerLazyTool({
      name: 'registered_tool',
      category: 'core',
      description: 'A registered tool',
      args: {},
      execute: async () => 'ok',
    });
    const tools = buildDiscoveryTools();
    const result = JSON.parse(await tools['list_available_tools'].execute({}));
    assert.ok(Array.isArray(result.tools));
    assert.ok(result.total >= 1);
  });

  test('load_tool returns full definition for a registered tool', async () => {
    registerLazyTool({
      name: 'my_test_tool',
      category: 'core',
      description: 'Full description here',
      args: { foo: {} },
      execute: async () => 'ok',
    });
    const tools = buildDiscoveryTools();
    const result = JSON.parse(await tools['load_tool'].execute({ name: 'my_test_tool' }));
    assert.strictEqual(result.name, 'my_test_tool');
    assert.strictEqual(result.loaded, true);
    assert.ok(result.description);
  });

  test('load_tool returns error for unknown tool', async () => {
    const tools = buildDiscoveryTools();
    const result = JSON.parse(await tools['load_tool'].execute({ name: 'nonexistent' }));
    assert.ok(result.error);
    assert.ok(result.hint);
  });
});

describe('createLazyToolWrapper', () => {
  test('wraps tool with lazy-load pointer in description', () => {
    const original = {
      name: 'wrapped_tool',
      category: 'core',
      description: 'Original description',
      args: { bar: {} },
      execute: async () => 'wrapped',
    };
    const wrapped = createLazyToolWrapper(original);
    assert.ok(wrapped.description.includes('[Tool: wrapped_tool]'));
    assert.ok(wrapped.description.includes('load_tool'));
  });

  test('wrapped tool delegates execute to original', async () => {
    const original = {
      name: 'wrapped_tool',
      category: 'core',
      description: 'Original',
      args: {},
      execute: async () => 'original-result',
    };
    const wrapped = createLazyToolWrapper(original);
    const result = await wrapped.execute({});
    assert.strictEqual(result, 'original-result');
  });
});

describe('lazy-load token savings', () => {
  test('pointer is shorter than full definition', () => {
    const original = {
      name: 'big_tool',
      category: 'erpnext',
      description: 'A very long description with many details about parameters and behavior that would waste tokens',
      args: { param1: {}, param2: {}, param3: {} },
      execute: async () => 'ok',
    };
    const wrapped = createLazyToolWrapper(original);
    // The wrapped description is a short pointer, much shorter than the original
    assert.ok(wrapped.description.length < original.description.length);
    assert.ok(wrapped.description.includes('[Tool: big_tool]'));
  });
});
