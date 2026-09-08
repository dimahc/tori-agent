import type { OntologyShape } from "@tori-agent/ontology";

export type Severity = "Violation" | "Warning";

export const Severity = {
  Violation: "Violation" as const,
  Warning: "Warning" as const,
} as const;

export interface ValidationIssue {
  entityId: string;
  property?: string;
  constraint: string;
  severity: Severity;
  message: string;
  filePath: string;
  lineNumber: number;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export type ShaclShape = OntologyShape;
