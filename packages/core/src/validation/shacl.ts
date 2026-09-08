import { ontologyShapes, type OntologyEntity, type OntologyShape } from "@tori-agent/ontology";
import type {
  ValidationIssue,
  ValidationResult,
} from "../types/validation.js";

function issue(
  entityId: string,
  property: string,
  constraint: string,
  message: string,
  filePath: string,
): ValidationIssue {
  return {
    entityId,
    property,
    constraint,
    severity: "Violation",
    message,
    filePath,
    lineNumber: 1,
  };
}

export class ShaclValidator {
  private readonly shapes: Map<string, OntologyShape>;

  constructor(shapes: OntologyShape[] = ontologyShapes) {
    this.shapes = new Map(shapes.map((shape) => [shape.targetType, shape]));
  }

  validate(entityId: string, entityData: OntologyEntity, filePath: string): ValidationResult {
    const shape = this.shapes.get(entityData["@type"]);
    if (!shape) {
      return { valid: true, issues: [] };
    }

    const issues: ValidationIssue[] = [];

    const data = entityData as unknown as Record<string, unknown>;

    for (const property of shape.required) {
      const value = data[property];
      if (value === undefined || value === null || value === "") {
        issues.push(issue(entityId, property, "required", `Missing required property '${property}'`, filePath));
      }
    }

    for (const property of shape.arrayProperties ?? []) {
      const value = data[property];
      if (value !== undefined && !Array.isArray(value)) {
        issues.push(issue(entityId, property, "array", `Property '${property}' must be an array`, filePath));
      }
    }

    for (const property of shape.objectProperties ?? []) {
      const value = data[property];
      if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) {
        issues.push(issue(entityId, property, "object", `Property '${property}' must be an object`, filePath));
      }
    }

    for (const [property, allowedValues] of Object.entries(shape.enumProperties ?? {})) {
      const value = data[property];
      if (typeof value === "string" && !allowedValues.includes(value)) {
        issues.push(
          issue(
            entityId,
            property,
            "enum",
            `Property '${property}' must be one of: ${allowedValues.join(", ")}`,
            filePath,
          ),
        );
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
