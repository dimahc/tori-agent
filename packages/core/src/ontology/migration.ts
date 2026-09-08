import type { OntologyEntity } from "@tori-agent/ontology";
import type { MigrationRule, SemVer } from "../types/registry.js";

export const defaultMigrations: Record<string, never> = {};

export class MigrationEngine {
  constructor(private readonly _rules: MigrationRule[] = []) {}

  addRule(): void {
    throw new Error("Backward-compatibility migrations removed. Ontology is strict-only.");
  }

  removeRule(): boolean {
    return false;
  }

  findPath(): MigrationRule[] | null {
    return null;
  }

  migrate(_entity: OntologyEntity, _targetVersion: SemVer): OntologyEntity {
    throw new Error("Backward-compatibility migrations removed. Re-author entity to current ontology contract.");
  }

  getRules(): MigrationRule[] {
    return [];
  }

  canMigrate(): boolean {
    return false;
  }
}
