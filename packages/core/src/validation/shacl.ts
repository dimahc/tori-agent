/**
 * @file packages/core/src/validation/shacl.ts
 * @description Implementation of the SHACL validation engine as defined in SC-02.
 */

import { 
  ValidationIssue, 
  ValidationResult, 
  ShaclShape, 
  ShaclPropertyConstraint, 
  Severity 
} from '../types/validation.js';

/**
 * A specialized SHACL validator designed for the Neuro-symbolic Triad.
 * It validates ontological entities against structural and semantic constraints.
 */
export class ShaclValidator {
  private shapes: Map<string, ShaclShape>;

  constructor(shapes: ShaclShape[]) {
    this.shapes = new Map(shapes.map(shape => [shape.targetClass, shape]));
  }

  /**
   * Validates an entity against the registered SHACL shapes.
   * 
   * @param entity The entity to validate.
   * @param entityId The unique identifier of the entity.
   * @param entityData The raw data of the entity.
   * @param filePath The file path where the entity is defined.
   * @returns A ValidationResult containing any issues found.
   */
  public validate(
    entityId: string,
    entityData: any,
    filePath: string
  ): ValidationResult {
    const issues: ValidationIssue[] = [];
    
    // Determine the class of the entity (assuming 'type' or '@type' property)
    const entityType = entityData.type || entityData['@type'];
    
    if (!entityType) {
      issues.push(this.createIssue(
        entityId,
        'type',
        'Missing Type',
        Severity.Violation,
        'Entity must have a defined type to be validated against shapes.',
        filePath,
        1
      ));
      return { valid: false, issues };
    }

    const shape = this.shapes.get(entityType);
    if (!shape) {
      // If no shape is defined for this type, we skip validation (Open World assumption for unknown types)
      return { valid: true, issues: [] };
    }

    // 1. Validate Property Constraints
    if (shape.properties) {
      for (const [propertyName, constraints] of Object.entries(shape.properties)) {
        const values = this.getPropertyValues(entityData, propertyName);
        
        for (const constraint of constraints) {
          this.applyConstraint(
            entityId,
            propertyName,
            constraint,
            values,
            entityData,
            filePath,
            issues
          );
        }
      }
    }

    return {
      valid: issues.filter(i => i.severity === Severity.Violation).length === 0,
      issues
    };
  }

  /**
   * Internal method to apply specific SHACL constraints.
   */
  private applyConstraint(
    entityId: string,
    propertyName: string,
    constraint: ShaclPropertyConstraint,
    values: any[],
    entityData: any,
    filePath: string,
    issues: ValidationIssue[]
  ): void {
    const severity = constraint.severity || Severity.Violation;

    // sh:minCount
    if (constraint.minCount !== undefined && values.length < constraint.minCount) {
      issues.push(this.createIssue(
        entityId,
        propertyName,
        `sh:minCount (${constraint.minCount})`,
        severity,
        `Property '${propertyName}' must appear at least ${constraint.minCount} times.`,
        filePath,
        this.findLineNumber(entityData, propertyName, filePath)
      ));
    }

    // sh:maxCount
    if (constraint.maxCount !== undefined && values.length > constraint.maxCount) {
      issues.push(this.createIssue(
        entityId,
        propertyName,
        `sh:maxCount (${constraint.maxCount})`,
        severity,
        `Property '${propertyName}' must appear at most ${constraint.maxCount} times.`,
        filePath,
        this.findLineNumber(entityData, propertyName, filePath)
      ));
    }

    // Validate each value against datatype, pattern, and nodeKind
    for (const value of values) {
      // sh:datatype
      if (constraint.datatype && typeof value !== constraint.datatype) {
        issues.push(this.createIssue(
          entityId,
          propertyName,
          `sh:datatype (${constraint.datatype})`,
          severity,
          `Value '${value}' is not of type ${constraint.datatype}.`,
          filePath,
          this.findLineNumber(entityData, propertyName, filePath)
        ));
      }

      // sh:pattern
      if (constraint.pattern && typeof value === 'string') {
        const regex = new RegExp(constraint.pattern);
        if (!regex.test(value)) {
          issues.push(this.createIssue(
            entityId,
            propertyName,
            `sh:pattern (${constraint.pattern})`,
            severity,
            `Value '${value}' does not match pattern ${constraint.pattern}.`,
            filePath,
            this.findLineNumber(entityData, propertyName, filePath)
          ));
        }
      }

      // sh:nodeKind
      if (constraint.nodeKind) {
        const actualKind = this.getNodeKind(value);
        if (actualKind !== constraint.nodeKind) {
          issues.push(this.createIssue(
            entityId,
            propertyName,
            `sh:nodeKind (${constraint.nodeKind})`,
            severity,
            `Value '${value}' is not a ${constraint.nodeKind}.`,
            filePath,
            this.findLineNumber(entityData, propertyName, filePath)
          ));
        }
      }
    }
  }

  private getPropertyValues(data: any, property: string): any[] {
    const val = data[property];
    if (val === undefined || val === null) return [];
    return Array.isArray(val) ? val : [val];
  }

  private getNodeKind(value: any): 'uri' | 'blank-node' | 'literal' {
    if (typeof value === 'string' && value.startsWith('http')) return 'uri';
    if (typeof value === 'object' && value !== null) return 'blank-node';
    return 'literal';
  }

  private createIssue(
    entityId: string,
    property: string,
    constraint: string,
    severity: Severity,
    message: string,
    filePath: string,
    lineNumber: number
  ): ValidationIssue {
    return {
      entityId,
      property,
      constraint,
      severity,
      message: `[SHACL Violation] ${entityId}: ${property} ${constraint} (Severity: ${severity}) - ${message}`,
      filePath,
      lineNumber
    };
  }

  /**
   * Heuristic to find the line number of a property in a JSON-like object.
   * In a production environment, this would use a source map or a proper parser.
   */
  private findLineNumber(data: any, property: string, filePath: string): number {
    // For this implementation, we return 1 as a placeholder.
    // Real implementation would require parsing the file with line info.
    return 1;
  }
}
