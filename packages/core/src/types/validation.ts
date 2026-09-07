/**
 * @file packages/core/src/types/validation.ts
 * @description Types for the SHACL validation engine.
 */

export type Severity = 'Violation' | 'Warning';

export const Severity = {
  Violation: 'Violation' as const,
  Warning: 'Warning' as const,
} as const;

export interface ValidationIssue {
  /** The ID of the entity that failed validation */
  entityId: string;
  /** The property that failed validation */
  property?: string;
  /** The specific constraint that was violated */
  constraint: string;
  /** The severity level of the issue */
  severity: Severity;
  /** A human-readable error message */
  message: string;
  /** The file path where the entity is defined */
  filePath: string;
  /** The line number in the file where the error occurred */
  lineNumber: number;
}

export interface ValidationResult {
  /** Whether the validation passed (no violations) */
  valid: boolean;
  /** List of issues found during validation */
  issues: ValidationIssue[];
}

export interface ShaclShape {
  /** The target class for this shape */
  targetClass: string;
  /** Constraints on properties */
  properties?: Record<string, ShaclPropertyConstraint[]>;
}

export interface ShaclPropertyConstraint {
  /** Minimum number of occurrences */
  minCount?: number;
  /** Maximum number of occurrences */
  maxCount?: number;
  /** Expected datatype (e.g., 'string', 'number', 'boolean') */
  datatype?: string;
  /** Regex pattern for string values */
  pattern?: string;
  /** Expected node kind (e.g., 'uri', 'blank-node', 'literal') */
  nodeKind?: 'uri' | 'blank-node' | 'literal';
  /** Severity level for this specific constraint */
  severity?: Severity;
}
