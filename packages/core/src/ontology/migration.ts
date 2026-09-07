/**
 * @file packages/core/src/ontology/migration.ts
 * @description Migration engine for the Ontology Registry (SC-05).
 */

import { OntologicalEntity, OntologyId } from '../types/ontology.js';
import { SemVer, MigrationRule, MigrationFn } from '../types/registry.js';

/**
 * Default migration functions for common schema changes.
 */
export const defaultMigrations: Record<string, MigrationFn> = {
  /**
   * Migration from 1.0.0 to 1.1.0: Add optional metadata field to all entities.
   */
  '1.0.0->1.1.0': (entity: OntologicalEntity): OntologicalEntity => {
    if (!('metadata' in entity)) {
      return { ...entity, metadata: {} } as OntologicalEntity;
    }
    return entity;
  },

  /**
   * Migration from 1.1.0 to 2.0.0: Restructure Agent roles from array of objects to array of IDs.
   */
  '1.1.0->2.0.0': (entity: OntologicalEntity): OntologicalEntity => {
    if (entity['@type'] === 'Agent' && 'roles' in entity) {
      const roles = entity.roles as unknown[];
      if (Array.isArray(roles) && roles.length > 0 && typeof roles[0] === 'object' && roles[0] !== null && 'name' in roles[0]) {
        // Convert role objects to role IDs
        const roleIds = roles.map((r: any) => r['@id'] || r.name || `role-${Math.random().toString(36).substr(2, 9)}`);
        return { ...entity, roles: roleIds } as OntologicalEntity;
      }
    }
    return entity;
  },
};

/**
 * Migration engine for upgrading entity schemas.
 */
export class MigrationEngine {
  private rules: Map<string, MigrationRule> = new Map();
  private versionOrder: SemVer[] = [];

  constructor(customRules: MigrationRule[] = []) {
    // Register default migrations
    for (const [key, fn] of Object.entries(defaultMigrations)) {
      const [from, to] = key.split('->');
      this.addRule({ fromVersion: from, toVersion: to, migrate: fn });
    }

    // Register custom rules (override defaults)
    for (const rule of customRules) {
      this.addRule(rule);
    }

    this.rebuildVersionOrder();
  }

  /**
   * Add a migration rule.
   */
  addRule(rule: MigrationRule): void {
    const key = `${rule.fromVersion}->${rule.toVersion}`;
    this.rules.set(key, rule);
    this.rebuildVersionOrder();
  }

  /**
   * Remove a migration rule.
   */
  removeRule(fromVersion: SemVer, toVersion: SemVer): boolean {
    const key = `${fromVersion}->${toVersion}`;
    const deleted = this.rules.delete(key);
    if (deleted) this.rebuildVersionOrder();
    return deleted;
  }

  /**
   * Rebuild the sorted version order for pathfinding.
   */
  private rebuildVersionOrder(): void {
    const versions = new Set<SemVer>();
    for (const rule of this.rules.values()) {
      versions.add(rule.fromVersion);
      versions.add(rule.toVersion);
    }
    this.versionOrder = Array.from(versions).sort(this.compareVersions.bind(this));
  }

  /**
   * Compare two semantic versions.
   */
  private compareVersions(a: SemVer, b: SemVer): number {
    const parse = (v: SemVer) => v.split(/[.-]/).map(n => parseInt(n, 10) || 0);
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na !== nb) return na - nb;
    }
    return 0;
  }

  /**
   * Find a migration path from source to target version.
   * Uses Dijkstra-like algorithm on the version graph.
   */
  findPath(fromVersion: SemVer, toVersion: SemVer): MigrationRule[] | null {
    if (this.compareVersions(fromVersion, toVersion) >= 0) {
      return []; // No migration needed or downgrade not supported
    }

    // Build adjacency list
    const adj = new Map<SemVer, MigrationRule[]>();
    for (const rule of this.rules.values()) {
      if (!adj.has(rule.fromVersion)) adj.set(rule.fromVersion, []);
      adj.get(rule.fromVersion)!.push(rule);
    }

    // Dijkstra's algorithm
    const dist = new Map<SemVer, number>();
    const prev = new Map<SemVer, MigrationRule | null>();
    const visited = new Set<SemVer>();

    for (const v of this.versionOrder) {
      dist.set(v, Infinity);
      prev.set(v, null);
    }
    dist.set(fromVersion, 0);

    while (true) {
      // Find unvisited node with minimum distance
      let current: SemVer | null = null;
      let minDist = Infinity;
      for (const [v, d] of dist) {
        if (!visited.has(v) && d < minDist) {
          minDist = d;
          current = v;
        }
      }

      if (current === null || current === toVersion) break;

      visited.add(current);

      const neighbors = adj.get(current) || [];
      for (const rule of neighbors) {
        const alt = dist.get(current)! + 1;
        if (alt < dist.get(rule.toVersion)!) {
          dist.set(rule.toVersion, alt);
          prev.set(rule.toVersion, rule);
        }
      }
    }

    // Reconstruct path
    if (dist.get(toVersion) === Infinity) return null;

    const path: MigrationRule[] = [];
    let current = toVersion;
    while (current !== fromVersion) {
      const rule = prev.get(current);
      if (!rule) return null;
      path.unshift(rule);
      current = rule.fromVersion;
    }

    return path;
  }

  /**
   * Migrate an entity from its current version to the target version.
   */
  migrate(entity: OntologicalEntity, targetVersion: SemVer): OntologicalEntity {
    const currentVersion = this.getEntityVersion(entity);
    const path = this.findPath(currentVersion, targetVersion);

    if (!path || path.length === 0) {
      return entity; // No migration needed or not possible
    }

    let migrated = entity;
    for (const rule of path) {
      try {
        migrated = rule.migrate(migrated);
        // Update version after each step
        migrated = this.setEntityVersion(migrated, rule.toVersion);
      } catch (error) {
        throw new Error(`Migration failed at ${rule.fromVersion}->${rule.toVersion}: ${error}`);
      }
    }

    return migrated;
  }

  /**
   * Extract version from entity (from metadata or @context).
   */
  private getEntityVersion(entity: OntologicalEntity): SemVer {
    // Check metadata first
    if ('metadata' in entity && entity.metadata && typeof entity.metadata === 'object') {
      const meta = entity.metadata as Record<string, unknown>;
      if (typeof meta.schemaVersion === 'string') return meta.schemaVersion;
      if (typeof meta.version === 'string') return meta.version;
    }
    // Check @context
    if (entity['@context'] && typeof entity['@context'] === 'object') {
      const ctx = entity['@context'] as Record<string, unknown>;
      if (typeof ctx.version === 'string') return ctx.version;
    }
    // Default to 1.0.0
    return '1.0.0';
  }

  /**
   * Set version on entity.
   */
  private setEntityVersion(entity: OntologicalEntity, version: SemVer): OntologicalEntity {
    const metadata = (entity.metadata as Record<string, unknown>) || {};
    return {
      ...entity,
      metadata: { ...metadata, schemaVersion: version }
    } as OntologicalEntity;
  }

  /**
   * Get all registered migration rules.
   */
  getRules(): MigrationRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Check if migration is possible between two versions.
   */
  canMigrate(fromVersion: SemVer, toVersion: SemVer): boolean {
    return this.findPath(fromVersion, toVersion) !== null;
  }
}