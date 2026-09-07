import { 
  ShaclValidator, 
  OntologicalEntity 
} from '../validation/shacl.js';
import { 
  ShaclShape, 
  Severity 
} from '../types/validation.js';

import { describe, it, expect } from 'node:test';
import assert from 'node:assert';

// Helper to mimic Jest-like expect for node:test
const expect = (actual: any) => ({
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  toHaveLength: (expected: number) => assert.strictEqual(actual.length, expected),
  toBeNull: () => assert.strictEqual(actual, null),
  toBeUndefined: () => assert.strictEqual(actual, undefined),
  toBeTruthy: () => assert.ok(actual),
  toBeFalsy: () => assert.ok(!actual),
  some: (predicate: (val: any) => boolean) => assert.ok(actual.some(predicate)),
  find: (predicate: (val: any) => boolean) => {
    const found = actual.find(predicate);
    assert.ok(found, 'Element not found');
    return found;
  }
});

describe('ShaclValidator', () => {
  const shapes: ShaclShape[] = [
    {
      targetClass: 'Agent',
      properties: {
        roles: [
          { minCount: 1, severity: 'Violation' },
          { datatype: 'string' }
        ],
        temperature: [
          { datatype: 'number', severity: 'Warning' }
        ],
        id: [
          { pattern: '^agent-[0-9]+$', severity: 'Violation' }
        ]
      }
    }
  ];

  const validator = new ShaclValidator(shapes);

  it('should validate a perfect Agent object', () => {
    const perfectAgent: OntologicalEntity = {
      id: 'agent-123',
      type: 'Agent',
      properties: {
        roles: ['executor'],
        temperature: 0.7,
        id: 'agent-123'
      },
      filePath: 'specs/agent.json',
      lineNumber: 10
    };

    const result = validator.validate(perfectAgent);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should catch missing required fields (minCount)', () => {
    const invalidAgent: OntologicalEntity = {
      id: 'agent-123',
      type: 'Agent',
      properties: {
        roles: [], // minCount is 1
        temperature: 0.7
      },
      filePath: 'specs/agent.json',
      lineNumber: 10
    };

    const result = validator.validate(invalidAgent);
    expect(result.valid).toBe(false);
    expect(result.issues[0].constraint).toBe('minCount');
    expect(result.issues[0].severity).toBe('Violation');
  });

  it('should catch type mismatches', () => {
    const typeMismatchAgent: OntologicalEntity = {
      id: 'agent-123',
      type: 'Agent',
      properties: {
        roles: ['executor'],
        temperature: 'hot' // should be number
      },
      filePath: 'specs/agent.json',
      lineNumber: 10
    };

    const result = validator.validate(typeMismatchAgent);
    // Note: temperature is a Warning in our shape, so valid might still be true 
    // depending on how we define 'valid' (no Violations).
    // In our implementation, valid = !issues.some(i => i.severity === 'Violation')
    expect(result.valid).toBe(true); 
    expect(result.issues.some((i: any) => i.constraint === 'datatype' && i.property === 'temperature')).toBe(true);
    expect(result.issues.find((i: any) => i.property === 'temperature')?.severity).toBe('Warning');
  });

  it('should catch pattern mismatches', () => {
    const patternMismatchAgent: OntologicalEntity = {
      id: 'agent-123',
      type: 'Agent',
      properties: {
        roles: ['executor'],
        id: 'bad-id-format'
      },
      filePath: 'specs/agent.json',
      lineNumber: 10
    };

    const result = validator.validate(patternMismatchAgent);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i: any) => i.constraint === 'pattern')).toBe(true);
  });
});
