---
title: "[Spec-SC-05] Ontology Registry & Versioning"
status: draft
created: 2026-09-06
spec_id: SC-05
domain: ontology/governance
version: "0.1.0"
authors:
  - Lead Systems Architect
related_specs:
  - SC-01: Ontology Schema (informative dependency)
  - SC-04: JSON-LD Context & Serialization (informative dependency)
---

# [Spec-SC-05] Ontology Registry & Versioning

> **Informative Specification.** This document describes governance, versioning, and registry mechanics for the tori-agent ontology suite. It is informative — it does not define new normative constraints on instance data. Conformance to SC-01 through SC-04 is unaffected by this document. However, tooling described here (registry index, drift detection, migration runner) is expected to be implemented and is considered part of the operational contract of the system.

---

## 1. Executive Summary

### 1.1 Why Versioning Matters for an Operational Ontology

The tori-agent ontology is not a static academic artifact — it is a **living operational schema** that governs how agents are compiled, how capabilities are dispatched, and how knowledge graphs are validated at runtime. This creates a versioning problem that is qualitatively different from versioning a REST API or a database schema:

- **Agents are compiled against a specific ontology version.** When `tori generate` runs, it reads the active ontology and bakes capability declarations, role assignments, and tool permissions into each agent's compiled spec. If the ontology changes after compilation, the compiled agent may reference terms that no longer exist.
- **The runtime harness validates against the active ontology.** Every JSON-LD document entering the harness is validated against the SHACL shapes (SC-02) and the Datalog policy engine (SC-03). If an agent was compiled against version 0.1.0 but the harness is running version 0.2.0, validation may fail on terms that were renamed or removed.
- **Knowledge graphs accumulate over time.** The `.opencode/knowledge-graph.jsonld` file grows with every workflow execution. Instances created under version 0.1.0 must remain readable under version 0.2.0, or a migration must be applied.

Without a formal versioning model, the system will inevitably drift into an inconsistent state where different components are operating against different implicit versions of the ontology. This spec defines the mechanisms to prevent that.

### 1.2 The "Ontological Drift" Problem

**Ontological drift** occurs when the live system state diverges from the declared ontology. It manifests in three forms:

| Drift Type | Description | Example |
|-----------|-------------|---------|
| **Schema drift** | An agent spec references an ontology term that no longer exists | Agent spec declares `tori:hasSkill` but the property was renamed to `tori:usesSkill` in v0.2.0 |
| **Instance drift** | A persisted knowledge graph contains instances whose `@type` or property values reference removed or renamed terms | `.opencode/knowledge-graph.jsonld` contains `"@type": "tori:SpecialistAgent"` but the class was split into `tori:HumanAgent` and `tori:AutomatedAgent` |
| **Version mismatch** | A document's `tori:ontologyVersion` field declares a version that is incompatible with the active ontology | Document says `"ontologyVersion": "0.1.0"` but harness is running `1.0.0` (MAJOR bump) |

Drift is insidious because it is often silent: the system continues to function until a specific code path exercises the drifted term, at which point it fails in a way that is difficult to diagnose. The registry and drift detection mechanisms defined in this spec make drift visible and actionable before it causes runtime failures.

### 1.3 Three Versioning Dimensions

The tori-agent ontology has three independent versioning dimensions that must be tracked separately:

| Dimension | What It Versions | Identifier | Location |
|-----------|-----------------|-----------|----------|
| **Schema version** | The OWL class hierarchy, property definitions, and axioms (SC-01) | `owl:versionIRI` in `ontology.ttl` | `packages/ontology/registry/versions/<semver>/ontology.ttl` |
| **Context version** | The JSON-LD `@context` document and serialization rules (SC-04) | URI path segment in context URL | `packages/ontology/registry/versions/<semver>/context.jsonld` |
| **Instance version** | The version of the ontology against which a specific instance document was compiled or last migrated | `tori:ontologyVersion` property on every instance | `.opencode/knowledge-graph.jsonld`, agent spec files |

These three dimensions are **co-versioned** in this spec: a single semantic version number (e.g., `0.1.0`) refers to a consistent snapshot of all three. The registry index (`index.json`) is the authoritative record of which snapshot is active.

### 1.4 Semantic Versioning for Ontologies

This spec adopts **Semantic Versioning 2.0.0** (`MAJOR.MINOR.PATCH`) with ontology-specific semantics defined in Section 2.1. The key principle is:

- **MAJOR** bumps are breaking changes — existing instances MUST be migrated before they can be used with the new ontology version.
- **MINOR** bumps are additive changes — existing instances remain valid without migration, but new optional terms become available.
- **PATCH** bumps are non-breaking corrections — existing instances are valid without any changes.

### 1.5 Registry Role

The **Ontology Registry** is the single source of truth for:
- Which ontology version is currently active
- What files constitute each version (ontology, shapes, context)
- Which versions are compatible with which instance versions
- What changed between versions (changelog)
- How to migrate instances from one version to another

The registry is implemented as a directory structure under `packages/ontology/registry/` with a machine-readable `index.json` manifest and a TypeScript API class (`OntologyRegistry`) for programmatic access.

---

## 2. Ontological Versioning Model

### 2.1 Semantic Versioning for Ontologies

The following table defines what constitutes a MAJOR, MINOR, or PATCH change to the tori-agent ontology. These rules are normative for the purposes of registry management: any change that meets the criteria for a MAJOR bump MUST increment the major version, and so on.

| Change Type | Version Bump | Rationale | Examples |
|-------------|-------------|-----------|---------|
| Remove a class | **MAJOR** | Breaks all instances of that class | Delete `tori:Skill` |
| Remove an object property | **MAJOR** | Breaks all triples using that property | Delete `tori:hasRole` |
| Remove a datatype property | **MAJOR** | Breaks all triples using that property | Delete `tori:agentId` |
| Rename a class | **MAJOR** | Equivalent to remove + add; breaks `@type` references | `tori:SpecialistAgent` → `tori:AutomatedAgent` |
| Rename a property | **MAJOR** | Equivalent to remove + add; breaks all property references | `tori:hasSkill` → `tori:usesSkill` |
| Change property domain (restrictive) | **MAJOR** | Existing triples may violate the new domain constraint | `tori:hasRole` domain: `owl:Thing` → `tori:Agent` |
| Change property range (restrictive) | **MAJOR** | Existing triples may violate the new range constraint | `tori:hasCapability` range: `owl:Thing` → `tori:Capability` |
| Change property cardinality (restrictive) | **MAJOR** | Existing instances may have too many or too few values | `sh:maxCount` removed → `sh:maxCount 1` |
| Add a required property (sh:minCount ≥ 1) | **MAJOR** | Existing instances lack the required value | New `sh:minCount 1` SHACL constraint |
| Add a new OWL axiom (restrictive) | **MAJOR** | May invalidate previously valid instances | New `owl:disjointWith` between two classes |
| Add a new class | **MINOR** | Additive; existing instances unaffected | Add `tori:Team` |
| Add an optional object property | **MINOR** | Additive; existing instances unaffected | New `sh:maxCount` unbounded property |
| Add an optional datatype property | **MINOR** | Additive; existing instances unaffected | New `tori:description` property |
| Change property cardinality (permissive) | **MINOR** | Relaxes constraint; existing instances remain valid | `sh:maxCount 1` → `sh:maxCount` removed |
| Change property domain (permissive) | **MINOR** | Allows more subjects; existing triples remain valid | Domain: `tori:Agent` → `owl:Thing` |
| Change property range (permissive) | **MINOR** | Allows more objects; existing triples remain valid | Range: `tori:Capability` → `owl:Thing` |
| Add a new SHACL `sh:Warning` severity constraint | **MINOR** | Non-blocking; existing instances get a warning, not an error | New `sh:severity sh:Warning` shape |
| Deprecate a class (`owl:deprecated true`) | **MINOR** | Signals future removal; existing instances still valid | `tori:DerivedCapability owl:deprecated true` |
| Deprecate a property (`owl:deprecated true`) | **MINOR** | Signals future removal; existing instances still valid | `tori:hasSkill owl:deprecated true` |
| Fix a typo in `rdfs:label` | **PATCH** | Documentation only; no structural change | `"Capabilty"` → `"Capability"` |
| Add or update `rdfs:comment` | **PATCH** | Documentation only | Add human-readable description |
| Add or update `rdfs:seeAlso` | **PATCH** | Documentation only | Add reference to external resource |
| Fix a typo in `sh:message` | **PATCH** | Error message text only | Correct spelling in SHACL violation message |
| Add a SHACL `sh:Info` severity constraint | **PATCH** | Purely informational; no validation impact | New `sh:severity sh:Info` shape |
| Update checksum in registry index | **PATCH** | Registry metadata only | Recompute SHA-256 after whitespace normalization |

#### 2.1.1 Deprecation Policy

A class or property MUST be deprecated (`owl:deprecated "true"^^xsd:boolean`) for at least one MINOR version before it is removed in a MAJOR version. This gives consumers a migration window. The deprecation MUST be accompanied by:

1. A `rdfs:comment` explaining what replaces the deprecated term.
2. An entry in the `changelog.md` for the version that introduced the deprecation.
3. A `tori:replacedBy` annotation pointing to the replacement term (if applicable).

Example deprecation annotation in Turtle:

```turtle
tori:hasSkill a owl:ObjectProperty ;
    owl:deprecated "true"^^xsd:boolean ;
    rdfs:comment "Deprecated in 0.2.0. Use tori:usesSkill instead." ;
    tori:replacedBy tori:usesSkill ;
    rdfs:label "has skill (deprecated)" .
```

### 2.2 Version Identifiers

Each versioning dimension has a canonical identifier format:

#### 2.2.1 Ontology Version IRI

The OWL ontology file (`ontology.ttl`) MUST declare its version using `owl:versionIRI`:

```turtle
<https://tori-agent.dev/ontology/2026/core>
    a owl:Ontology ;
    owl:versionIRI <https://tori-agent.dev/ontology/2026/core/0.1.0> ;
    owl:versionInfo "0.1.0" ;
    rdfs:label "tori-agent Core Ontology" ;
    rdfs:comment "Core ontological classes and properties for the tori-agent system." ;
    dcterms:created "2026-09-06"^^xsd:date ;
    dcterms:modified "2026-09-06"^^xsd:date .
```

The version IRI pattern is: `https://tori-agent.dev/ontology/2026/core/<MAJOR>.<MINOR>.<PATCH>`

#### 2.2.2 Context Version URI

The JSON-LD context document is served at a versioned URI. The version is embedded in the URI path:

```
https://tori-agent.dev/ontology/2026/core/context.jsonld          # Canonical (always latest)
https://tori-agent.dev/ontology/2026/core/0.1.0/context.jsonld    # Version-pinned
```

Instance documents SHOULD use the version-pinned URI in their `@context` declaration to ensure reproducible processing. The canonical URI redirects to the latest version and SHOULD NOT be used in persisted documents.

#### 2.2.3 Instance Version Property

Every JSON-LD instance document (agent spec, knowledge graph, capability manifest) MUST include a `tori:ontologyVersion` property at the document root:

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/0.1.0/context.jsonld",
  "@type": "tori:KnowledgeGraph",
  "tori:ontologyVersion": "0.1.0",
  "tori:generatedAt": "2026-09-06T14:30:00Z",
  "@graph": [ ... ]
}
```

The value MUST be a valid semantic version string matching the pattern `^\d+\.\d+\.\d+$`.

### 2.3 Compatibility Rules

The following rules govern when an instance document compiled against version N is valid against ontology version M:

#### 2.3.1 PATCH Compatibility (always compatible)

An instance compiled against version `N.n.p` is valid against any version `N.n.p'` where `p' >= p`. PATCH changes are purely additive or corrective and cannot invalidate existing instances.

```
Instance version: 0.1.0  →  Ontology version: 0.1.3  ✓  Compatible
Instance version: 0.1.3  →  Ontology version: 0.1.0  ✓  Compatible (downgrade within PATCH)
```

#### 2.3.2 MINOR Compatibility (forward compatible)

An instance compiled against version `N.n.p` is valid against any version `N.n'.p'` where `n' >= n`. MINOR changes are additive: new optional terms are available but not required. Existing instances do not reference the new terms and therefore remain valid.

```
Instance version: 0.1.0  →  Ontology version: 0.3.0  ✓  Compatible (forward)
Instance version: 0.3.0  →  Ontology version: 0.1.0  ✗  Incompatible (backward — instance may use terms not in older ontology)
```

#### 2.3.3 MAJOR Incompatibility (migration required)

An instance compiled against version `N.n.p` is **invalid** against any version `M.m.p'` where `M != N`. MAJOR changes include breaking modifications (removed terms, renamed terms, tightened cardinalities) that may render existing instances structurally invalid.

```
Instance version: 0.1.0  →  Ontology version: 1.0.0  ✗  Incompatible — migration required
Instance version: 1.0.0  →  Ontology version: 0.1.0  ✗  Incompatible — downgrade not supported
```

#### 2.3.4 Compatibility Matrix

The registry `index.json` encodes the compatibility matrix explicitly for each version. The `compatibleWith` array lists all instance versions that are valid against a given ontology version without migration:

```json
"1.0.0": {
  "compatibleWith": ["1.0.0", "0.3.0", "0.2.0"],
  "breakingFrom": ["0.1.0"]
}
```

This allows the harness to perform an O(1) compatibility check: look up the active ontology version in the registry, check if the instance's `tori:ontologyVersion` is in the `compatibleWith` array.

#### 2.3.5 Harness Enforcement

The harness MUST enforce compatibility at document ingestion time:

1. Extract `tori:ontologyVersion` from the incoming document.
2. Look up the active ontology version in the registry.
3. Check if the instance version is in the `compatibleWith` array.
4. If **compatible**: proceed with SHACL validation and Datalog reasoning.
5. If **incompatible**: reject the document with a structured error:

```json
{
  "error": "ONTOLOGY_VERSION_INCOMPATIBLE",
  "instanceVersion": "0.1.0",
  "activeOntologyVersion": "1.0.0",
  "message": "Instance compiled against ontology 0.1.0 is not compatible with active ontology 1.0.0. Run 'tori ontology migrate 1.0.0' to migrate.",
  "migrationAvailable": true
}
```

---

## 3. Registry Architecture

### 3.1 Registry Directory Structure

The registry lives under `packages/ontology/registry/`. This directory is part of the `@tori-agent/ontology` package (to be created as part of the ontological upgrade implementation). The structure is:

```
packages/ontology/
├── package.json
├── tsconfig.json
├── src/
│   ├── registry.ts          # OntologyRegistry class
│   ├── migration.ts         # MigrationRunner class
│   ├── drift.ts             # DriftDetector class
│   ├── types.ts             # All TypeScript interfaces
│   └── index.ts             # Public API exports
├── registry/
│   ├── index.json           # Active version manifest (machine-readable)
│   └── versions/
│       ├── 0.1.0/
│       │   ├── ontology.ttl         # OWL ontology snapshot
│       │   ├── shapes.ttl           # SHACL shapes snapshot
│       │   ├── context.jsonld       # JSON-LD context snapshot
│       │   ├── changelog.md         # What changed in this version
│       │   └── migration.ts         # Migration script (only for MAJOR bumps)
│       └── 0.2.0/
│           ├── ontology.ttl
│           ├── shapes.ttl
│           ├── context.jsonld
│           ├── changelog.md
│           └── migration.ts
├── migrations/
│   ├── 0.1.0-to-0.2.0.ts   # MINOR migration (additive defaults)
│   └── 0.2.0-to-1.0.0.ts   # MAJOR migration (breaking changes)
└── tests/
    ├── registry.test.ts
    ├── migration.test.ts
    └── drift.test.ts
```

**Immutability invariant:** Once a version directory is committed and tagged, its files MUST NOT be modified. Any correction requires a new PATCH version. This ensures that checksums in `index.json` remain valid and that version-pinned context URIs always resolve to the same content.

### 3.2 Registry Index Format

The `registry/index.json` file is the machine-readable manifest of all registered ontology versions. It MUST conform to the following JSON schema:

```json
{
  "$schema": "https://tori-agent.dev/ontology/registry-index-schema.json",
  "activeVersion": "0.1.0",
  "latestStableVersion": "0.1.0",
  "latestPreviewVersion": null,
  "updatedAt": "2026-09-06T00:00:00Z",
  "versions": {
    "0.1.0": {
      "status": "active",
      "stability": "stable",
      "releasedAt": "2026-09-06T00:00:00Z",
      "deprecatedAt": null,
      "retiredAt": null,
      "ontologyIRI": "https://tori-agent.dev/ontology/2026/core#",
      "versionIRI": "https://tori-agent.dev/ontology/2026/core/0.1.0",
      "contextURI": "https://tori-agent.dev/ontology/2026/core/0.1.0/context.jsonld",
      "compatibleWith": ["0.1.0"],
      "breakingFrom": [],
      "migrationRequired": false,
      "files": {
        "ontology": "versions/0.1.0/ontology.ttl",
        "shapes": "versions/0.1.0/shapes.ttl",
        "context": "versions/0.1.0/context.jsonld",
        "changelog": "versions/0.1.0/changelog.md"
      },
      "checksum": {
        "algorithm": "sha256",
        "ontology": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "shapes": "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
        "context": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
      },
      "stats": {
        "classes": 12,
        "objectProperties": 48,
        "datatypeProperties": 12,
        "axioms": 7,
        "shaclShapes": 12,
        "datalogRules": 7
      },
      "changelog": {
        "summary": "Initial release of the tori-agent core ontology.",
        "breaking": [],
        "added": [
          "12 core classes: Agent, SpecialistAgent, Role, Capability, DerivedCapability, Skill, Tool, MCPTool, BuiltinTool, Workflow, WorkflowStage, Artifact",
          "48 object properties",
          "12 datatype properties",
          "7 OWL axioms",
          "12 SHACL node shapes",
          "7 Datalog inference rules (C1–C7)"
        ],
        "deprecated": [],
        "fixed": []
      }
    }
  }
}
```

#### 3.2.1 Version Status Values

| Status | Meaning | Harness Behavior |
|--------|---------|-----------------|
| `active` | The currently deployed version | All new instances MUST use this version |
| `stable` | Released and supported, but not active | Instances may still use this version; migration recommended |
| `deprecated` | Supported but scheduled for retirement | Harness logs a warning; migration strongly recommended |
| `retired` | No longer supported | Harness rejects instances with this version |
| `preview` | Pre-release; not for production use | Harness accepts only in development mode |

#### 3.2.2 Checksum Verification

The `checksum` object stores SHA-256 hashes of the canonical file content (UTF-8 encoded, LF line endings, no trailing whitespace). The `OntologyRegistry` class verifies these checksums on startup and throws `OntologyIntegrityError` if any file has been modified since the version was registered.

### 3.3 Registry API (TypeScript)

The `OntologyRegistry` class provides the programmatic interface to the registry. It is the only supported way to interact with the registry from application code — direct file system access to `registry/index.json` is discouraged outside of the registry implementation itself.

#### 3.3.1 TypeScript Interfaces

```typescript
// packages/ontology/src/types.ts

/**
 * Semantic version string in MAJOR.MINOR.PATCH format.
 */
export type SemVer = string;

/**
 * SHA-256 hex digest string (64 hex characters).
 */
export type Sha256Digest = string;

/**
 * Status of a registered ontology version.
 */
export type VersionStatus = "active" | "stable" | "deprecated" | "retired" | "preview";

/**
 * Stability tier of a registered ontology version.
 */
export type VersionStability = "stable" | "preview" | "experimental";

/**
 * File paths for the artifacts that constitute an ontology version.
 */
export interface OntologyVersionFiles {
  /** Path to the OWL ontology Turtle file, relative to registry root. */
  ontology: string;
  /** Path to the SHACL shapes Turtle file, relative to registry root. */
  shapes: string;
  /** Path to the JSON-LD context file, relative to registry root. */
  context: string;
  /** Path to the changelog Markdown file, relative to registry root. */
  changelog: string;
  /** Path to the migration TypeScript file (MAJOR versions only). */
  migration?: string;
}

/**
 * SHA-256 checksums for the files in an ontology version.
 */
export interface OntologyVersionChecksums {
  algorithm: "sha256";
  ontology: Sha256Digest;
  shapes: Sha256Digest;
  context: Sha256Digest;
}

/**
 * Statistical summary of an ontology version's content.
 */
export interface OntologyVersionStats {
  classes: number;
  objectProperties: number;
  datatypeProperties: number;
  axioms: number;
  shaclShapes: number;
  datalogRules: number;
}

/**
 * Structured changelog for a single ontology version.
 */
export interface OntologyVersionChangelog {
  /** One-line summary of the release. */
  summary: string;
  /** Breaking changes (MAJOR bump items). */
  breaking: string[];
  /** New additions (MINOR bump items). */
  added: string[];
  /** Deprecations introduced in this version. */
  deprecated: string[];
  /** Bug fixes and corrections (PATCH bump items). */
  fixed: string[];
}

/**
 * Complete metadata record for a single registered ontology version.
 */
export interface OntologyVersion {
  /** Semantic version string, e.g. "0.1.0". */
  version: SemVer;
  /** Lifecycle status of this version. */
  status: VersionStatus;
  /** Stability tier. */
  stability: VersionStability;
  /** ISO 8601 timestamp when this version was released. */
  releasedAt: string;
  /** ISO 8601 timestamp when this version was deprecated, or null. */
  deprecatedAt: string | null;
  /** ISO 8601 timestamp when this version was retired, or null. */
  retiredAt: string | null;
  /** Canonical ontology namespace IRI. */
  ontologyIRI: string;
  /** Version-specific ontology IRI (owl:versionIRI value). */
  versionIRI: string;
  /** Version-pinned JSON-LD context URI. */
  contextURI: string;
  /**
   * List of instance versions that are valid against this ontology version
   * without migration. Includes the version itself.
   */
  compatibleWith: SemVer[];
  /**
   * List of instance versions that are NOT compatible with this ontology
   * version and require migration before use.
   */
  breakingFrom: SemVer[];
  /** Whether instances from older versions require migration to use this version. */
  migrationRequired: boolean;
  /** File paths for this version's artifacts. */
  files: OntologyVersionFiles;
  /** SHA-256 checksums for integrity verification. */
  checksum: OntologyVersionChecksums;
  /** Statistical summary of this version's content. */
  stats: OntologyVersionStats;
  /** Structured changelog for this version. */
  changelog: OntologyVersionChangelog;
}

/**
 * The top-level registry index structure (registry/index.json).
 */
export interface RegistryIndex {
  /** JSON Schema URI for this document. */
  $schema: string;
  /** The currently active ontology version. */
  activeVersion: SemVer;
  /** The latest stable (non-preview) version. */
  latestStableVersion: SemVer;
  /** The latest preview version, or null if none. */
  latestPreviewVersion: SemVer | null;
  /** ISO 8601 timestamp of the last registry update. */
  updatedAt: string;
  /** Map from version string to version metadata. */
  versions: Record<SemVer, OntologyVersion>;
}

/**
 * A single entry in a computed changelog between two versions.
 */
export interface ChangelogEntry {
  /** The version that introduced this change. */
  version: SemVer;
  /** ISO 8601 release date of this version. */
  releasedAt: string;
  /** Version bump type for this release. */
  bumpType: "major" | "minor" | "patch";
  /** Structured changelog for this version. */
  changelog: OntologyVersionChangelog;
}

/**
 * A single step in a computed migration path between two versions.
 */
export interface MigrationStep {
  /** Source version for this step. */
  fromVersion: SemVer;
  /** Target version for this step. */
  toVersion: SemVer;
  /** Whether this step involves breaking changes. */
  isBreaking: boolean;
  /** Human-readable description of what this step does. */
  description: string;
  /** Path to the migration script, relative to registry root. */
  migrationScript?: string;
  /** Estimated time to run this migration (informative). */
  estimatedDurationMs?: number;
}

/**
 * Options for constructing an OntologyRegistry instance.
 */
export interface OntologyRegistryOptions {
  /** Absolute path to the registry root directory. Defaults to the bundled registry. */
  registryPath?: string;
  /** Whether to verify file checksums on startup. Defaults to true. */
  verifyChecksums?: boolean;
  /** Whether to allow preview versions to be set as active. Defaults to false. */
  allowPreview?: boolean;
}

/**
 * Error thrown when a registry file fails checksum verification.
 */
export class OntologyIntegrityError extends Error {
  constructor(
    public readonly version: SemVer,
    public readonly file: string,
    public readonly expectedChecksum: Sha256Digest,
    public readonly actualChecksum: Sha256Digest,
  ) {
    super(
      `Integrity check failed for ${file} in version ${version}. ` +
      `Expected ${expectedChecksum}, got ${actualChecksum}. ` +
      `The registry file may have been modified after release.`
    );
    this.name = "OntologyIntegrityError";
  }
}

/**
 * Error thrown when a version is not found in the registry.
 */
export class OntologyVersionNotFoundError extends Error {
  constructor(public readonly version: SemVer) {
    super(`Ontology version '${version}' is not registered. Run 'tori ontology list' to see available versions.`);
    this.name = "OntologyVersionNotFoundError";
  }
}
```

#### 3.3.2 OntologyRegistry Class

```typescript
// packages/ontology/src/registry.ts

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  ChangelogEntry,
  MigrationStep,
  OntologyRegistryOptions,
  OntologyVersion,
  RegistryIndex,
  SemVer,
} from "./types.js";
import {
  OntologyIntegrityError,
  OntologyVersionNotFoundError,
} from "./types.js";

/**
 * OntologyRegistry provides the programmatic interface to the tori-agent
 * ontology version registry. It is the single source of truth for which
 * ontology version is active, what files constitute each version, and
 * which versions are compatible with which instance documents.
 *
 * @example
 * ```typescript
 * const registry = new OntologyRegistry();
 * const active = registry.getActiveVersion();
 * console.log(active.version); // "0.1.0"
 *
 * const compatible = registry.isCompatible("0.1.0", "0.1.3");
 * console.log(compatible); // true
 * ```
 */
export class OntologyRegistry {
  private readonly index: RegistryIndex;
  private readonly registryPath: string;

  constructor(options: OntologyRegistryOptions = {}) {
    this.registryPath = options.registryPath
      ?? resolve(new URL("../../registry", import.meta.url).pathname);

    const indexPath = join(this.registryPath, "index.json");
    const raw = readFileSync(indexPath, "utf-8");
    this.index = JSON.parse(raw) as RegistryIndex;

    if (options.verifyChecksums !== false) {
      this.verifyAllChecksums();
    }
  }

  /**
   * Returns the currently active ontology version.
   * Throws OntologyVersionNotFoundError if the active version is not registered.
   */
  getActiveVersion(): OntologyVersion {
    return this.getVersion(this.index.activeVersion);
  }

  /**
   * Returns the metadata for a specific ontology version.
   * Throws OntologyVersionNotFoundError if the version is not registered.
   */
  getVersion(semver: SemVer): OntologyVersion {
    const entry = this.index.versions[semver];
    if (!entry) {
      throw new OntologyVersionNotFoundError(semver);
    }
    return { ...entry, version: semver };
  }

  /**
   * Returns true if an instance compiled against instanceVersion is valid
   * against the given ontologyVersion without migration.
   *
   * Implements the compatibility rules from Section 2.3:
   * - PATCH: always compatible within the same MAJOR.MINOR
   * - MINOR: forward compatible (instance <= ontology MINOR)
   * - MAJOR: incompatible (requires migration)
   */
  isCompatible(instanceVersion: SemVer, ontologyVersion: SemVer): boolean {
    const ontologyEntry = this.index.versions[ontologyVersion];
    if (!ontologyEntry) return false;
    return ontologyEntry.compatibleWith.includes(instanceVersion);
  }

  /**
   * Returns all registered versions, sorted by semantic version (ascending).
   */
  listVersions(): OntologyVersion[] {
    return Object.entries(this.index.versions)
      .map(([version, entry]) => ({ ...entry, version }))
      .sort((a, b) => this.compareSemVer(a.version, b.version));
  }

  /**
   * Returns the changelog entries between two versions (exclusive of fromVersion,
   * inclusive of toVersion), sorted chronologically.
   *
   * @param fromVersion - The starting version (exclusive).
   * @param toVersion - The ending version (inclusive).
   */
  getChangelog(fromVersion: SemVer, toVersion: SemVer): ChangelogEntry[] {
    const versions = this.listVersions();
    const fromIdx = versions.findIndex(v => v.version === fromVersion);
    const toIdx = versions.findIndex(v => v.version === toVersion);

    if (fromIdx === -1) throw new OntologyVersionNotFoundError(fromVersion);
    if (toIdx === -1) throw new OntologyVersionNotFoundError(toVersion);
    if (fromIdx >= toIdx) return [];

    return versions.slice(fromIdx + 1, toIdx + 1).map(v => ({
      version: v.version,
      releasedAt: v.releasedAt,
      bumpType: this.classifyBump(versions[fromIdx].version, v.version),
      changelog: v.changelog,
    }));
  }

  /**
   * Computes the migration path from one version to another.
   * Returns an ordered list of migration steps. Each step corresponds to
   * a single version increment. MINOR and PATCH steps may have no migration
   * script (they are no-ops or additive defaults).
   *
   * @param fromVersion - The source version.
   * @param toVersion - The target version.
   */
  getMigrationPath(fromVersion: SemVer, toVersion: SemVer): MigrationStep[] {
    const versions = this.listVersions();
    const fromIdx = versions.findIndex(v => v.version === fromVersion);
    const toIdx = versions.findIndex(v => v.version === toVersion);

    if (fromIdx === -1) throw new OntologyVersionNotFoundError(fromVersion);
    if (toIdx === -1) throw new OntologyVersionNotFoundError(toVersion);
    if (fromIdx === toIdx) return [];

    const steps: MigrationStep[] = [];
    const slice = fromIdx < toIdx
      ? versions.slice(fromIdx, toIdx)
      : versions.slice(toIdx, fromIdx).reverse();

    for (let i = 0; i < slice.length; i++) {
      const from = slice[i];
      const to = fromIdx < toIdx ? versions[fromIdx + i + 1] : versions[toIdx + i + 1];
      const isBreaking = this.parseMajor(to.version) !== this.parseMajor(from.version);

      steps.push({
        fromVersion: from.version,
        toVersion: to.version,
        isBreaking,
        description: to.changelog.summary,
        migrationScript: to.files.migration,
      });
    }

    return steps;
  }

  /**
   * Returns the absolute path to a registry file for a given version.
   */
  resolveFile(version: SemVer, fileKey: keyof OntologyVersion["files"]): string {
    const entry = this.getVersion(version);
    const relativePath = entry.files[fileKey];
    if (!relativePath) {
      throw new Error(`No '${fileKey}' file registered for version ${version}.`);
    }
    return join(this.registryPath, relativePath);
  }

  /**
   * Returns the raw content of a registry file for a given version.
   */
  readFile(version: SemVer, fileKey: keyof OntologyVersion["files"]): string {
    return readFileSync(this.resolveFile(version, fileKey), "utf-8");
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private verifyAllChecksums(): void {
    for (const [version, entry] of Object.entries(this.index.versions)) {
      for (const [fileKey, expectedDigest] of Object.entries(entry.checksum)) {
        if (fileKey === "algorithm") continue;
        const filePath = join(this.registryPath, entry.files[fileKey as keyof typeof entry.files]!);
        const content = readFileSync(filePath, "utf-8");
        const actualDigest = createHash("sha256").update(content, "utf-8").digest("hex");
        if (actualDigest !== expectedDigest) {
          throw new OntologyIntegrityError(version, filePath, expectedDigest, actualDigest);
        }
      }
    }
  }

  private compareSemVer(a: SemVer, b: SemVer): number {
    const [aMaj, aMin, aPat] = a.split(".").map(Number);
    const [bMaj, bMin, bPat] = b.split(".").map(Number);
    return aMaj !== bMaj ? aMaj - bMaj : aMin !== bMin ? aMin - bMin : aPat - bPat;
  }

  private parseMajor(v: SemVer): number {
    return parseInt(v.split(".")[0], 10);
  }

  private classifyBump(from: SemVer, to: SemVer): "major" | "minor" | "patch" {
    const [fMaj, fMin] = from.split(".").map(Number);
    const [tMaj, tMin] = to.split(".").map(Number);
    if (tMaj !== fMaj) return "major";
    if (tMin !== fMin) return "minor";
    return "patch";
  }
}
```

---

## 4. Ontological Drift Detection

### 4.1 What is Ontological Drift?

Ontological drift is the condition where the live system state — agent specs, knowledge graphs, capability manifests, workflow definitions — diverges from the declared active ontology. It is the ontological equivalent of a type error: the system believes it is operating on data of type X, but the data was actually produced under a schema where X had different semantics.

Drift occurs in three primary scenarios:

**Scenario 1: Post-release agent spec update lag.** A MINOR version is released adding a new `tori:Team` class. An agent spec author updates their spec to reference `tori:memberOf` (the new property), but the spec was not regenerated with `tori generate`. The compiled agent file still references the old context URI and does not include the new property in its capability declaration.

**Scenario 2: Knowledge graph accumulation.** The `.opencode/knowledge-graph.jsonld` file was created under version 0.1.0. A MAJOR version 1.0.0 is released that renames `tori:SpecialistAgent` to `tori:AutomatedAgent`. The knowledge graph still contains `"@type": "tori:SpecialistAgent"` for all existing agent instances. SHACL validation against the new shapes will fail for every existing agent.

**Scenario 3: Stale capability manifest.** The `capabilities.json` manifest was generated under version 0.1.0. A new agent spec was added but `tori generate` was not re-run. The capability index does not include the new agent's capabilities, causing dispatch to miss it.

### 4.2 Drift Detection Mechanism

The system employs three complementary drift detection mechanisms:

#### 4.2.1 Static Analysis at Generate Time

When `node packages/cli/dist/cli.js generate` runs, the CLI performs a static analysis pass over all agent spec YAML files:

1. Load the active ontology version from the registry.
2. Extract all ontology term references from each spec (class names, property names, capability identifiers).
3. Validate each term against the active ontology's term inventory.
4. Report any unrecognized or deprecated terms as drift violations.

This is the primary prevention mechanism: drift is caught before it reaches the runtime.

#### 4.2.2 Runtime Version Check

The harness performs a version compatibility check on every incoming JSON-LD document (Section 2.3.5). This is the runtime enforcement layer: even if a drifted document somehow bypasses static analysis, the harness will reject it.

#### 4.2.3 Periodic Audit via `tori doctor`

The `tori doctor` command (to be implemented) performs a full drift scan across the `.opencode/` directory:

1. Scan all `.jsonld`, `.yaml`, and `.json` files.
2. Extract all ontology term references.
3. Validate against the active ontology version.
4. Generate a `DriftReport` (Section 4.3).
5. Print a human-readable summary and exit with code 1 if any violations are found.

### 4.3 Drift Report Format

```typescript
// packages/ontology/src/types.ts (continued)

/**
 * Severity level for a drift finding.
 */
export type DriftSeverity = "error" | "warning" | "info";

/**
 * A single drift violation (blocking — term no longer exists).
 */
export interface DriftViolation {
  /** Absolute path to the file containing the violation. */
  file: string;
  /** Line number within the file (1-indexed), if determinable. */
  line?: number;
  /** Column number within the file (1-indexed), if determinable. */
  column?: number;
  /** The ontology term that was referenced (e.g., "tori:hasSkill"). */
  term: string;
  /**
   * The type of drift issue:
   * - "term_removed": The term no longer exists in the active ontology.
   * - "term_renamed": The term was renamed; a replacement is available.
   * - "version_mismatch": The document's ontologyVersion is incompatible.
   * - "term_deprecated": The term exists but is marked owl:deprecated.
   * - "unknown_term": The term is not recognized at all (possible typo).
   */
  issue: "term_removed" | "term_renamed" | "version_mismatch" | "term_deprecated" | "unknown_term";
  /** Severity of this violation. */
  severity: DriftSeverity;
  /** Human-readable description of the issue. */
  message: string;
  /** Migration hint or suggested fix, if available. */
  suggestion?: string;
  /** The replacement term, if the issue is "term_renamed". */
  replacedBy?: string;
}

/**
 * A non-blocking drift warning (term deprecated, version behind, etc.).
 */
export interface DriftWarning {
  /** Absolute path to the file containing the warning. */
  file: string;
  /** Line number within the file (1-indexed), if determinable. */
  line?: number;
  /** The ontology term that triggered the warning. */
  term: string;
  /** Type of warning. */
  issue: "term_deprecated" | "version_behind" | "missing_version_field";
  /** Human-readable description of the warning. */
  message: string;
  /** Suggested action. */
  suggestion?: string;
}

/**
 * Complete drift report produced by the drift detector.
 */
export interface DriftReport {
  /** ISO 8601 timestamp when the scan was performed. */
  scannedAt: string;
  /** The active ontology version against which the scan was performed. */
  activeOntologyVersion: string;
  /** The root directory that was scanned. */
  scannedDirectory: string;
  /** All blocking violations found. */
  violations: DriftViolation[];
  /** All non-blocking warnings found. */
  warnings: DriftWarning[];
  /** Summary statistics. */
  summary: {
    violations: number;
    warnings: number;
    filesScanned: number;
    termsChecked: number;
    /** True if any violations were found (exit code 1 indicator). */
    hasErrors: boolean;
  };
}
```

### 4.4 Drift Severity Levels

| Severity | Condition | Harness Behavior | CLI Behavior |
|----------|-----------|-----------------|-------------|
| **ERROR** | Term no longer exists in active ontology | Rejects document; workflow cannot proceed | `tori ontology validate` exits with code 1 |
| **ERROR** | Instance version is MAJOR-incompatible | Rejects document; migration required | `tori ontology validate` exits with code 1 |
| **WARNING** | Term exists but is `owl:deprecated` | Logs warning; continues processing | `tori ontology validate` exits with code 0; warning printed |
| **WARNING** | Instance version is MINOR behind active | Logs warning; continues processing | `tori ontology validate` exits with code 0; warning printed |
| **INFO** | Instance version is PATCH behind active | No log; transparent | `tori ontology validate` exits with code 0; info printed with `--verbose` |
| **INFO** | Document missing `tori:ontologyVersion` field | Assumes active version; logs info | `tori ontology validate` exits with code 0; info printed |

### 4.5 DriftDetector Class

```typescript
// packages/ontology/src/drift.ts

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import type { DriftReport, DriftViolation, DriftWarning } from "./types.js";
import type { OntologyRegistry } from "./registry.js";

/**
 * DriftDetector scans a directory for ontological drift — references to
 * ontology terms that are incompatible with the active ontology version.
 */
export class DriftDetector {
  constructor(private readonly registry: OntologyRegistry) {}

  /**
   * Scans a directory recursively for drift violations.
   *
   * @param directory - Absolute path to the directory to scan.
   * @param extensions - File extensions to scan (default: [".jsonld", ".yaml", ".yml", ".json"]).
   */
  async scan(
    directory: string,
    extensions: string[] = [".jsonld", ".yaml", ".yml", ".json"],
  ): Promise<DriftReport> {
    const activeVersion = this.registry.getActiveVersion();
    const files = this.collectFiles(directory, extensions);
    const violations: DriftViolation[] = [];
    const warnings: DriftWarning[] = [];
    let termsChecked = 0;

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const fileViolations = this.analyzeFile(file, content, activeVersion.version);
      violations.push(...fileViolations.violations);
      warnings.push(...fileViolations.warnings);
      termsChecked += fileViolations.termsChecked;
    }

    return {
      scannedAt: new Date().toISOString(),
      activeOntologyVersion: activeVersion.version,
      scannedDirectory: directory,
      violations,
      warnings,
      summary: {
        violations: violations.length,
        warnings: warnings.length,
        filesScanned: files.length,
        termsChecked,
        hasErrors: violations.length > 0,
      },
    };
  }

  private collectFiles(dir: string, extensions: string[]): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory() && !entry.startsWith(".") && entry !== "node_modules") {
        results.push(...this.collectFiles(fullPath, extensions));
      } else if (stat.isFile() && extensions.includes(extname(entry))) {
        results.push(fullPath);
      }
    }
    return results;
  }

  private analyzeFile(
    file: string,
    content: string,
    activeVersion: string,
  ): { violations: DriftViolation[]; warnings: DriftWarning[]; termsChecked: number } {
    // Extract all tori: prefixed terms from the file content.
    const termPattern = /\btori:([A-Za-z][A-Za-z0-9_]*)\b/g;
    const violations: DriftViolation[] = [];
    const warnings: DriftWarning[] = [];
    let termsChecked = 0;
    let match: RegExpExecArray | null;

    const lines = content.split("\n");

    while ((match = termPattern.exec(content)) !== null) {
      const term = `tori:${match[1]}`;
      const lineNumber = content.slice(0, match.index).split("\n").length;
      termsChecked++;

      // Check if the term is known in the active ontology.
      // (In a real implementation, this would query the OWL/SHACL files.)
      const termStatus = this.checkTerm(term, activeVersion);

      if (termStatus === "removed") {
        violations.push({
          file,
          line: lineNumber,
          term,
          issue: "term_removed",
          severity: "error",
          message: `Term '${term}' was removed in a previous version and no longer exists in ontology ${activeVersion}.`,
          suggestion: `Check the changelog for version ${activeVersion} to find the replacement term.`,
        });
      } else if (termStatus === "deprecated") {
        warnings.push({
          file,
          line: lineNumber,
          term,
          issue: "term_deprecated",
          message: `Term '${term}' is deprecated in ontology ${activeVersion} and will be removed in the next MAJOR version.`,
          suggestion: `Check the ontology for the tori:replacedBy annotation on '${term}'.`,
        });
      }
    }

    return { violations, warnings, termsChecked };
  }

  /**
   * Checks the status of an ontology term in the active version.
   * Returns "active", "deprecated", "removed", or "unknown".
   *
   * In a full implementation, this would parse the OWL Turtle file and
   * check for owl:deprecated annotations and term existence.
   */
  private checkTerm(
    _term: string,
    _version: string,
  ): "active" | "deprecated" | "removed" | "unknown" {
    // Stub: real implementation queries the OWL file via an RDF library.
    return "active";
  }
}
```

---

## 5. Migration Framework

### 5.1 Migration Script Interface

Every MAJOR version bump MUST include a migration script that transforms instance documents from the previous version to the new version. MINOR and PATCH bumps MAY include migration scripts that apply additive defaults (e.g., setting a new optional property to a sensible default value).

```typescript
// packages/ontology/src/types.ts (continued)

/**
 * A JSON-LD graph document — the top-level structure of a knowledge graph file.
 */
export interface JsonLdGraph {
  "@context": string | Record<string, unknown>;
  "@type"?: string;
  "tori:ontologyVersion": string;
  "tori:generatedAt": string;
  "@graph": JsonLdNode[];
  [key: string]: unknown;
}

/**
 * A single node in a JSON-LD graph.
 */
export interface JsonLdNode {
  "@id": string;
  "@type": string | string[];
  [property: string]: unknown;
}

/**
 * The interface that every migration script must implement.
 * Migration scripts are TypeScript modules that export a default
 * OntologyMigration instance.
 */
export interface OntologyMigration {
  /** The source version this migration migrates FROM. */
  fromVersion: SemVer;
  /** The target version this migration migrates TO. */
  toVersion: SemVer;
  /** Human-readable description of what this migration does. */
  description: string;
  /**
   * Applies the migration to a JSON-LD graph document.
   * Returns the migrated graph. The input graph is not mutated.
   *
   * @param graph - The source JSON-LD graph to migrate.
   * @returns A new JSON-LD graph conforming to toVersion.
   */
  migrate(graph: JsonLdGraph): Promise<JsonLdGraph>;
  /**
   * Validates that a graph conforms to the target version's schema.
   * Called after migrate() to verify the migration produced a valid result.
   *
   * @param graph - The migrated JSON-LD graph to validate.
   * @returns True if the graph is valid; false otherwise.
   */
  validate(graph: JsonLdGraph): Promise<boolean>;
}

/**
 * A plan for migrating from one version to another, potentially via
 * multiple intermediate steps.
 */
export interface MigrationPlan {
  fromVersion: SemVer;
  toVersion: SemVer;
  steps: MigrationStep[];
  /** Whether any step in the plan involves breaking changes. */
  hasBreakingChanges: boolean;
  /** Total number of steps. */
  stepCount: number;
}

/**
 * A preview of what a migration would change, produced by dryRun().
 */
export interface MigrationPreview {
  plan: MigrationPlan;
  /** Number of nodes that would be modified. */
  nodesModified: number;
  /** Number of nodes that would be added. */
  nodesAdded: number;
  /** Number of nodes that would be removed. */
  nodesRemoved: number;
  /** Number of properties that would be renamed. */
  propertiesRenamed: number;
  /** Human-readable summary of changes. */
  changeSummary: string[];
}

/**
 * A checkpoint saved before executing a migration, enabling rollback.
 */
export interface MigrationCheckpoint {
  /** ISO 8601 timestamp when the checkpoint was created. */
  createdAt: string;
  /** The version of the graph before migration. */
  version: SemVer;
  /** The original graph, deep-copied before migration. */
  originalGraph: JsonLdGraph;
}
```

### 5.2 Migration Types

The following migration types cover the full range of ontological changes:

#### 5.2.1 Term Rename Migration

The most common MAJOR migration. Renames a class or property across all nodes in the graph:

```typescript
// Example: rename tori:hasSkill → tori:usesSkill across all nodes
async migrate(graph: JsonLdGraph): Promise<JsonLdGraph> {
  const migrated = structuredClone(graph);
  for (const node of migrated["@graph"]) {
    if ("tori:hasSkill" in node) {
      node["tori:usesSkill"] = node["tori:hasSkill"];
      delete node["tori:hasSkill"];
    }
  }
  migrated["tori:ontologyVersion"] = this.toVersion;
  return migrated;
}
```

#### 5.2.2 Property Restructure Migration

Transforms the shape of a property — for example, flattening a nested object into a flat string, or splitting a compound property into two separate properties:

```typescript
// Example: split tori:agentId (compound "type:id") into tori:agentType + tori:agentLocalId
async migrate(graph: JsonLdGraph): Promise<JsonLdGraph> {
  const migrated = structuredClone(graph);
  for (const node of migrated["@graph"]) {
    if (typeof node["tori:agentId"] === "string") {
      const [agentType, agentLocalId] = (node["tori:agentId"] as string).split(":", 2);
      node["tori:agentType"] = agentType;
      node["tori:agentLocalId"] = agentLocalId;
      delete node["tori:agentId"];
    }
  }
  migrated["tori:ontologyVersion"] = this.toVersion;
  return migrated;
}
```

#### 5.2.3 Class Split Migration

When one class is split into two subclasses, the migration must determine which subclass each existing instance belongs to. This often requires a human decision or a heuristic:

```typescript
// Example: split tori:Agent into tori:HumanAgent and tori:AutomatedAgent
// Heuristic: if the agent has tori:personaId, it is a HumanAgent; otherwise AutomatedAgent
async migrate(graph: JsonLdGraph): Promise<JsonLdGraph> {
  const migrated = structuredClone(graph);
  for (const node of migrated["@graph"]) {
    if (node["@type"] === "tori:Agent") {
      node["@type"] = "tori:personaId" in node
        ? "tori:HumanAgent"
        : "tori:AutomatedAgent";
    }
  }
  migrated["tori:ontologyVersion"] = this.toVersion;
  return migrated;
}
```

**Note:** Class split migrations that cannot be resolved by a heuristic MUST be flagged as requiring human review. The `MigrationRunner.dryRun()` method will report these as `REQUIRES_HUMAN_DECISION` items in the `MigrationPreview`.

#### 5.2.4 Cardinality Tightening Migration

When a property's cardinality is tightened (e.g., from `0..*` to `0..1`), existing instances may have multiple values where only one is now allowed. The migration must select one value and discard the rest:

```typescript
// Example: tori:primaryRole changes from 0..* to 0..1
// Strategy: keep the first value, discard the rest
async migrate(graph: JsonLdGraph): Promise<JsonLdGraph> {
  const migrated = structuredClone(graph);
  for (const node of migrated["@graph"]) {
    if (Array.isArray(node["tori:primaryRole"]) && node["tori:primaryRole"].length > 1) {
      // Keep only the first role; log a warning for discarded values.
      node["tori:primaryRole"] = node["tori:primaryRole"][0];
    }
  }
  migrated["tori:ontologyVersion"] = this.toVersion;
  return migrated;
}
```

### 5.3 MigrationRunner Class

```typescript
// packages/ontology/src/migration.ts

import { join } from "node:path";
import type {
  JsonLdGraph,
  MigrationCheckpoint,
  MigrationPlan,
  MigrationPreview,
  OntologyMigration,
  SemVer,
} from "./types.js";
import type { OntologyRegistry } from "./registry.js";

/**
 * MigrationRunner orchestrates the execution of ontology migrations.
 * It computes migration plans, performs dry runs, executes migrations,
 * and supports rollback via checkpoints.
 */
export class MigrationRunner {
  constructor(private readonly registry: OntologyRegistry) {}

  /**
   * Computes a migration plan from one version to another.
   * The plan consists of an ordered list of migration steps, each
   * corresponding to a single version increment.
   *
   * @param from - The source version.
   * @param to - The target version.
   */
  plan(from: SemVer, to: SemVer): MigrationPlan {
    const steps = this.registry.getMigrationPath(from, to);
    return {
      fromVersion: from,
      toVersion: to,
      steps,
      hasBreakingChanges: steps.some(s => s.isBreaking),
      stepCount: steps.length,
    };
  }

  /**
   * Performs a dry run of a migration plan, showing what would change
   * without actually modifying the graph.
   *
   * @param graph - The source JSON-LD graph.
   * @param migrationPlan - The migration plan to preview.
   */
  async dryRun(graph: JsonLdGraph, migrationPlan: MigrationPlan): Promise<MigrationPreview> {
    // Apply the migration to a deep clone and diff the result.
    const original = structuredClone(graph);
    const migrated = await this.applyPlan(structuredClone(graph), migrationPlan);

    const originalIds = new Set(original["@graph"].map(n => n["@id"]));
    const migratedIds = new Set(migrated["@graph"].map(n => n["@id"]));

    const nodesAdded = [...migratedIds].filter(id => !originalIds.has(id)).length;
    const nodesRemoved = [...originalIds].filter(id => !migratedIds.has(id)).length;
    const nodesModified = migrated["@graph"].filter(node => {
      const orig = original["@graph"].find(n => n["@id"] === node["@id"]);
      return orig && JSON.stringify(orig) !== JSON.stringify(node);
    }).length;

    return {
      plan: migrationPlan,
      nodesModified,
      nodesAdded,
      nodesRemoved,
      propertiesRenamed: 0, // Computed by individual migration scripts
      changeSummary: migrationPlan.steps.map(s =>
        `${s.fromVersion} → ${s.toVersion}: ${s.description}`
      ),
    };
  }

  /**
   * Executes a migration plan against a JSON-LD graph.
   * Creates a checkpoint before executing so that rollback is possible.
   *
   * @param graph - The source JSON-LD graph to migrate.
   * @param migrationPlan - The migration plan to execute.
   * @returns The migrated graph and the checkpoint for rollback.
   */
  async execute(
    graph: JsonLdGraph,
    migrationPlan: MigrationPlan,
  ): Promise<{ graph: JsonLdGraph; checkpoint: MigrationCheckpoint }> {
    const checkpoint: MigrationCheckpoint = {
      createdAt: new Date().toISOString(),
      version: graph["tori:ontologyVersion"],
      originalGraph: structuredClone(graph),
    };

    const migrated = await this.applyPlan(structuredClone(graph), migrationPlan);
    return { graph: migrated, checkpoint };
  }

  /**
   * Rolls back a graph to its state before a migration was applied.
   *
   * @param _graph - The migrated graph (unused; checkpoint contains the original).
   * @param checkpoint - The checkpoint created before the migration.
   */
  rollback(_graph: JsonLdGraph, checkpoint: MigrationCheckpoint): JsonLdGraph {
    return structuredClone(checkpoint.originalGraph);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async applyPlan(graph: JsonLdGraph, plan: MigrationPlan): Promise<JsonLdGraph> {
    let current = graph;
    for (const step of plan.steps) {
      if (!step.migrationScript) continue;
      const scriptPath = join(
        this.registry.resolveFile(step.toVersion, "migration" as never),
      );
      const { default: migration } = await import(scriptPath) as { default: OntologyMigration };
      current = await migration.migrate(current);
    }
    return current;
  }
}
```

### 5.4 Example Migration: 0.1.0 → 0.2.0

This section describes a hypothetical MINOR migration that adds a `tori:Team` class and a `tori:memberOf` property. Since this is a MINOR bump (additive only), no existing instances are broken. The migration script applies an additive default: agents that are not yet members of any team get an empty `tori:memberOf` array.

```typescript
// packages/ontology/migrations/0.1.0-to-0.2.0.ts

import type { JsonLdGraph, OntologyMigration } from "../src/types.js";

/**
 * Migration: 0.1.0 → 0.2.0
 *
 * Changes in 0.2.0:
 * - Added tori:Team class (new)
 * - Added tori:memberOf property (optional, 0..*)
 *
 * Migration strategy:
 * - No breaking changes; all existing instances remain valid.
 * - Optionally initialize tori:memberOf to [] on all Agent instances
 *   to make the new property explicit. This is not required for validity
 *   but makes the schema evolution visible in the knowledge graph.
 */
const migration: OntologyMigration = {
  fromVersion: "0.1.0",
  toVersion: "0.2.0",
  description: "Add tori:Team class and tori:memberOf property (MINOR — additive only).",

  async migrate(graph: JsonLdGraph): Promise<JsonLdGraph> {
    const migrated = structuredClone(graph);

    for (const node of migrated["@graph"]) {
      // Initialize tori:memberOf on Agent instances that don't have it yet.
      const nodeType = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
      const isAgent = nodeType.some(t =>
        t === "tori:Agent" || t === "tori:SpecialistAgent"
      );

      if (isAgent && !("tori:memberOf" in node)) {
        node["tori:memberOf"] = [];
      }
    }

    // Update the ontology version declaration.
    migrated["tori:ontologyVersion"] = "0.2.0";
    migrated["tori:migratedAt"] = new Date().toISOString();
    migrated["tori:migratedFrom"] = "0.1.0";

    return migrated;
  },

  async validate(graph: JsonLdGraph): Promise<boolean> {
    // Verify that the version field was updated.
    if (graph["tori:ontologyVersion"] !== "0.2.0") return false;

    // Verify that all Agent nodes have tori:memberOf (even if empty).
    for (const node of graph["@graph"]) {
      const nodeType = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
      const isAgent = nodeType.some(t =>
        t === "tori:Agent" || t === "tori:SpecialistAgent"
      );
      if (isAgent && !("tori:memberOf" in node)) return false;
    }

    return true;
  },
};

export default migration;
```

---

## 6. CLI Integration

### 6.1 `tori ontology` Command Suite

The `tori ontology` subcommand provides a complete interface for managing ontology versions, inspecting drift, and executing migrations. All subcommands are implemented in `packages/cli/src/commands/ontology.ts`.

#### `tori ontology status`

Displays the current ontology status: active version, file checksums, drift summary, and any pending migrations.

```
$ tori ontology status

Ontology Registry Status
════════════════════════
Active version:    0.1.0  (stable)
Released:          2026-09-06
Ontology IRI:      https://tori-agent.dev/ontology/2026/core/0.1.0
Context URI:       https://tori-agent.dev/ontology/2026/core/0.1.0/context.jsonld

File Integrity
──────────────
  ontology.ttl    ✓  sha256:e3b0c44...
  shapes.ttl      ✓  sha256:a665a45...
  context.jsonld  ✓  sha256:2cf24db...

Drift Summary (scanned .opencode/)
────────────────────────────────────
  Files scanned:  12
  Violations:     0
  Warnings:       0
  Status:         ✓ No drift detected

Knowledge Graph
───────────────
  File:           .opencode/knowledge-graph.jsonld
  Instance ver:   0.1.0
  Compatible:     ✓ Yes
```

#### `tori ontology list`

Lists all registered ontology versions with their status and release dates.

```
$ tori ontology list

Registered Ontology Versions
═════════════════════════════
  VERSION   STATUS      RELEASED     CLASSES  PROPERTIES  COMPATIBLE WITH
  ───────   ──────      ────────     ───────  ──────────  ───────────────
  0.1.0 *   active      2026-09-06   12       48          0.1.0

* = active version
```

#### `tori ontology diff <v1> <v2>`

Shows a structured diff between two ontology versions, organized by change type.

```
$ tori ontology diff 0.1.0 0.2.0

Ontology Diff: 0.1.0 → 0.2.0
══════════════════════════════
Bump type: MINOR (additive — no migration required)

Added Classes (1)
─────────────────
  + tori:Team
      rdfs:label "Team"
      rdfs:comment "A group of agents working together on a shared goal."

Added Properties (1)
─────────────────────
  + tori:memberOf  (ObjectProperty)
      domain:  tori:Agent
      range:   tori:Team
      sh:maxCount: (unbounded)
      rdfs:label "member of"

Deprecated Terms (0)
─────────────────────
  (none)

Breaking Changes (0)
─────────────────────
  (none)
```

#### `tori ontology validate`

Runs the full drift detection scan against the `.opencode/` directory and reports violations.

```
$ tori ontology validate

Scanning .opencode/ against ontology 0.1.0...

Files scanned:  12
Terms checked:  847
Violations:     0
Warnings:       0

✓ No ontological drift detected.

$ echo $?
0
```

With violations:

```
$ tori ontology validate

Scanning .opencode/ against ontology 1.0.0...

Files scanned:  12
Terms checked:  847
Violations:     3
Warnings:       1

ERRORS
──────
  .opencode/agents/specialist.yaml:14  tori:hasSkill
    Issue: term_removed — 'tori:hasSkill' was removed in version 1.0.0.
    Fix:   Replace with 'tori:usesSkill' (renamed in 1.0.0 changelog).

  .opencode/agents/specialist.yaml:22  tori:SpecialistAgent
    Issue: term_renamed — 'tori:SpecialistAgent' was renamed to 'tori:AutomatedAgent'.
    Fix:   Update @type declaration to 'tori:AutomatedAgent'.

  .opencode/knowledge-graph.jsonld:1   (document root)
    Issue: version_mismatch — instance version '0.1.0' is incompatible with active '1.0.0'.
    Fix:   Run 'tori ontology migrate 1.0.0' to migrate the knowledge graph.

WARNINGS
────────
  .opencode/agents/scribe.yaml:8  tori:hasRole
    Issue: term_deprecated — 'tori:hasRole' is deprecated in 1.0.0.
    Fix:   Replace with 'tori:assignedRole' before the next MAJOR release.

✗ 3 violations found. Fix errors before proceeding.

$ echo $?
1
```

#### `tori ontology migrate <to>`

Migrates the knowledge graph and all agent specs to the target ontology version.

```
$ tori ontology migrate 1.0.0

Migration Plan: 0.1.0 → 1.0.0
═══════════════════════════════
Steps:
  1. 0.1.0 → 0.2.0  (MINOR — additive defaults)
  2. 0.2.0 → 1.0.0  (MAJOR — breaking changes)

Breaking changes in step 2:
  - tori:hasSkill renamed to tori:usesSkill
  - tori:SpecialistAgent renamed to tori:AutomatedAgent
  - tori:hasRole deprecated (replacement: tori:assignedRole)

Dry run preview:
  Nodes modified:    47
  Nodes added:       0
  Nodes removed:     0
  Properties renamed: 2

Checkpoint will be saved to: .opencode/migration-checkpoints/0.1.0-backup-20260906T143000Z.jsonld

Proceed? [y/N]: y

✓ Checkpoint saved.
✓ Step 1 complete: 0.1.0 → 0.2.0 (47 nodes updated)
✓ Step 2 complete: 0.2.0 → 1.0.0 (47 nodes updated)
✓ Migration complete. Knowledge graph is now at version 1.0.0.

Run 'tori ontology validate' to verify.
```

#### `tori ontology inspect <term>`

Shows the full definition of an ontology term in the active version.

```
$ tori ontology inspect tori:Capability

Term: tori:Capability
═════════════════════
Type:        owl:Class
Label:       Capability
Comment:     An atomic unit of work that an agent can perform.
Defined in:  0.1.0
Status:      active

Subclasses:
  - tori:DerivedCapability

Used as domain in:
  - tori:hasCapability (range: tori:Capability)

SHACL Shape: tori:CapabilityShape
  sh:property tori:capabilityId  (sh:minCount 1, sh:maxCount 1, xsd:string)
  sh:property tori:capabilityName (sh:minCount 1, sh:maxCount 1, xsd:string)
  sh:property tori:capabilityScope (sh:maxCount 1, tori:CapabilityScope)

Datalog rules that reference this term:
  C2: hasCapability(A, C) :- hasRole(A, R), roleGrantsCapability(R, C).
  C3: hasCapability(A, C) :- hasCapability(A, D), derivedFrom(D, C).
```

### 6.2 `tori inspect <agent_id>` Command

The `tori inspect` command (recommended by Architect 3) provides a deep inspection of a compiled agent, showing its ontological provenance and any drift violations.

```
$ tori inspect specialist:software-engineer

Agent Inspection: specialist:software-engineer
═══════════════════════════════════════════════
Compiled against:  ontology 0.1.0
Active ontology:   0.1.0
Drift status:      ✓ No drift

Identity
────────
  @id:    tori:agent/specialist/software-engineer
  @type:  tori:SpecialistAgent
  Label:  Senior Software Engineer

Roles (2)
─────────
  tori:role/implementer
  tori:role/code-reviewer

Capabilities (5)
─────────────────
  code.write        (via role: implementer)
  code.review       (via role: code-reviewer)
  test.write        (via role: implementer)
  file.read         (via tool: filesystem)
  file.write        (via tool: filesystem)

Tools (2)
──────────
  filesystem  (tori:BuiltinTool)
  bash        (tori:BuiltinTool, restricted: npm/npx/node/go/cargo/make)

Prompt Schema
─────────────
  Persona:  Senior Software Engineer
  Mode:     executor
  Injected context size: ~4,200 tokens

Ontological Provenance
──────────────────────
  Spec file:       packages/core/spec/agents/specialist-software-engineer.yaml
  Generated at:    2026-09-06T14:30:00Z
  Context URI:     https://tori-agent.dev/ontology/2026/core/0.1.0/context.jsonld
```

### 6.3 Integration with `generate` Command

When `node packages/cli/dist/cli.js generate` runs, the following ontology-aware steps are performed in addition to the existing agent compilation:

1. **Load active registry version.** Read `packages/ontology/registry/index.json` and instantiate `OntologyRegistry`.
2. **Validate all agent specs.** Run `DriftDetector.scan()` over `packages/core/spec/agents/`. Report violations as warnings (non-blocking in the current implementation; will become blocking in a future MAJOR version).
3. **Generate capability manifest.** Write `capabilities.json` to the output directory (`.opencode/` or `.kilocode/`). See Section 7.
4. **Stamp ontology version.** Write the active ontology version into each generated agent file's metadata.
5. **Report drift summary.** Print a one-line summary of drift findings at the end of the generate run.

Example generate output with drift warnings:

```
$ node packages/cli/dist/cli.js generate

Generating agents...
  ✓ specialist:software-engineer
  ✓ specialist:infrastructure
  ✓ tori:orchestrator
  ✓ tori:scribe

Ontology validation (0.1.0)...
  ⚠ packages/core/spec/agents/specialist-software-engineer.yaml:14
    tori:hasSkill is deprecated. Replace with tori:usesSkill.

Capability manifest written to .opencode/capabilities.json
Agents written to .opencode/agents/ (4 files)
Builtin skills synced to .opencode/skills/ (7 files)

Summary: 4 agents generated, 1 ontology warning, 0 errors.
```

---

## 7. Capability Manifest

### 7.1 Purpose and Role

The `capabilities.json` manifest is a pre-computed index of all agent capabilities, generated by `tori generate` and consumed by the harness at dispatch time. It serves two purposes:

1. **O(1) capability dispatch** (Architect 2's recommendation): The `capabilityIndex` is a reverse map from capability identifier to the list of agents that possess that capability. The harness can find all agents capable of `code.write` in O(1) without scanning all agent specs.
2. **Ontological provenance**: The manifest records the ontology version under which it was generated, enabling the harness to detect stale manifests.

### 7.2 Manifest Format

```json
{
  "$schema": "https://tori-agent.dev/ontology/capability-manifest-schema.json",
  "generatedAt": "2026-09-06T14:30:00Z",
  "ontologyVersion": "0.1.0",
  "generatorVersion": "0.1.0",
  "agentCount": 4,
  "capabilityCount": 12,
  "agents": {
    "specialist:software-engineer": {
      "agentId": "tori:agent/specialist/software-engineer",
      "agentType": "tori:SpecialistAgent",
      "label": "Senior Software Engineer",
      "capabilities": [
        "code.write",
        "code.review",
        "test.write",
        "file.read",
        "file.write"
      ],
      "tools": [
        "filesystem",
        "bash"
      ],
      "roles": [
        "implementer",
        "code-reviewer"
      ],
      "persona": "Senior Software Engineer",
      "mode": "executor",
      "specFile": "packages/core/spec/agents/specialist-software-engineer.yaml",
      "compiledAt": "2026-09-06T14:30:00Z"
    },
    "specialist:infrastructure": {
      "agentId": "tori:agent/specialist/infrastructure",
      "agentType": "tori:SpecialistAgent",
      "label": "Infrastructure Engineer",
      "capabilities": [
        "infra.provision",
        "infra.deploy",
        "code.review",
        "file.read",
        "file.write"
      ],
      "tools": [
        "filesystem",
        "bash",
        "terraform",
        "kubectl"
      ],
      "roles": [
        "infrastructure-engineer",
        "code-reviewer"
      ],
      "persona": "Infrastructure Engineer",
      "mode": "executor",
      "specFile": "packages/core/spec/agents/specialist-infrastructure.yaml",
      "compiledAt": "2026-09-06T14:30:00Z"
    },
    "tori:orchestrator": {
      "agentId": "tori:agent/orchestrator",
      "agentType": "tori:Agent",
      "label": "Tori Orchestrator",
      "capabilities": [
        "workflow.plan",
        "workflow.dispatch",
        "workflow.review",
        "agent.spawn",
        "agent.monitor"
      ],
      "tools": [
        "lifecycle",
        "workflow",
        "scratchpad"
      ],
      "roles": [
        "orchestrator",
        "planner"
      ],
      "persona": "Tori Orchestrator",
      "mode": "orchestrator",
      "specFile": "packages/core/spec/agents/tori-orchestrator.yaml",
      "compiledAt": "2026-09-06T14:30:00Z"
    },
    "tori:scribe": {
      "agentId": "tori:agent/scribe",
      "agentType": "tori:Agent",
      "label": "Tori Scribe",
      "capabilities": [
        "doc.write",
        "doc.update",
        "spec.write",
        "file.read",
        "file.write"
      ],
      "tools": [
        "filesystem",
        "confluence"
      ],
      "roles": [
        "scribe",
        "documentarian"
      ],
      "persona": "Technical Writer",
      "mode": "scribe",
      "specFile": "packages/core/spec/agents/tori-scribe.yaml",
      "compiledAt": "2026-09-06T14:30:00Z"
    }
  },
  "capabilityIndex": {
    "code.write": [
      "specialist:software-engineer"
    ],
    "code.review": [
      "specialist:software-engineer",
      "specialist:infrastructure"
    ],
    "test.write": [
      "specialist:software-engineer"
    ],
    "file.read": [
      "specialist:software-engineer",
      "specialist:infrastructure",
      "tori:scribe"
    ],
    "file.write": [
      "specialist:software-engineer",
      "specialist:infrastructure",
      "tori:scribe"
    ],
    "infra.provision": [
      "specialist:infrastructure"
    ],
    "infra.deploy": [
      "specialist:infrastructure"
    ],
    "workflow.plan": [
      "tori:orchestrator"
    ],
    "workflow.dispatch": [
      "tori:orchestrator"
    ],
    "workflow.review": [
      "tori:orchestrator"
    ],
    "agent.spawn": [
      "tori:orchestrator"
    ],
    "agent.monitor": [
      "tori:orchestrator"
    ],
    "doc.write": [
      "tori:scribe"
    ],
    "doc.update": [
      "tori:scribe"
    ],
    "spec.write": [
      "tori:scribe"
    ]
  },
  "roleIndex": {
    "implementer": [
      "specialist:software-engineer"
    ],
    "code-reviewer": [
      "specialist:software-engineer",
      "specialist:infrastructure"
    ],
    "infrastructure-engineer": [
      "specialist:infrastructure"
    ],
    "orchestrator": [
      "tori:orchestrator"
    ],
    "planner": [
      "tori:orchestrator"
    ],
    "scribe": [
      "tori:scribe"
    ],
    "documentarian": [
      "tori:scribe"
    ]
  }
}
```

### 7.3 TypeScript Interfaces

```typescript
// packages/ontology/src/types.ts (continued)

/**
 * Capability identifier string (e.g., "code.write", "infra.deploy").
 * Format: <domain>.<action> using dot notation.
 */
export type CapabilityId = string;

/**
 * Agent identifier string (e.g., "specialist:software-engineer").
 * Format: <namespace>:<local-name> using colon notation.
 */
export type AgentId = string;

/**
 * Role identifier string (e.g., "implementer", "code-reviewer").
 */
export type RoleId = string;

/**
 * Metadata for a single agent in the capability manifest.
 */
export interface AgentCapabilityEntry {
  /** Fully qualified agent IRI (e.g., "tori:agent/specialist/software-engineer"). */
  agentId: string;
  /** OWL class of the agent (e.g., "tori:SpecialistAgent"). */
  agentType: string;
  /** Human-readable label. */
  label: string;
  /** List of capability identifiers this agent possesses. */
  capabilities: CapabilityId[];
  /** List of tool identifiers this agent has access to. */
  tools: string[];
  /** List of role identifiers assigned to this agent. */
  roles: RoleId[];
  /** Persona name injected into the agent's system prompt. */
  persona: string;
  /** Operational mode (executor, orchestrator, scribe, etc.). */
  mode: string;
  /** Path to the source spec file, relative to the workspace root. */
  specFile: string;
  /** ISO 8601 timestamp when this entry was compiled. */
  compiledAt: string;
}

/**
 * The complete capability manifest generated by `tori generate`.
 */
export interface CapabilityManifest {
  /** JSON Schema URI for this document. */
  $schema: string;
  /** ISO 8601 timestamp when the manifest was generated. */
  generatedAt: string;
  /** Ontology version under which this manifest was generated. */
  ontologyVersion: SemVer;
  /** Version of the generator (CLI) that produced this manifest. */
  generatorVersion: string;
  /** Total number of agents in the manifest. */
  agentCount: number;
  /** Total number of unique capabilities across all agents. */
  capabilityCount: number;
  /**
   * Map from agent identifier to agent capability entry.
   * Key: AgentId (e.g., "specialist:software-engineer")
   */
  agents: Record<AgentId, AgentCapabilityEntry>;
  /**
   * Reverse index: capability → list of agents that possess it.
   * Enables O(1) dispatch: find all agents capable of X.
   * Key: CapabilityId (e.g., "code.write")
   */
  capabilityIndex: Record<CapabilityId, AgentId[]>;
  /**
   * Reverse index: role → list of agents assigned to it.
   * Key: RoleId (e.g., "implementer")
   */
  roleIndex: Record<RoleId, AgentId[]>;
}
```

### 7.4 Manifest Staleness Detection

The harness detects a stale capability manifest by comparing the manifest's `ontologyVersion` and `generatedAt` fields against the active registry version and the modification timestamps of the agent spec files. If the manifest is stale, the harness logs a warning and recommends running `tori generate`.

A manifest is considered stale if:
1. `manifest.ontologyVersion` does not match the active registry version, OR
2. Any agent spec file has a modification timestamp newer than `manifest.generatedAt`.

---

## 8. Ontological Drift Prevention Strategies

Drift is easier to prevent than to remediate. The following strategies, applied together, make drift a rare and quickly-detected condition rather than a chronic background problem.

### 8.1 Ontology-First Development

The ontology is the source of truth. Changes to agent behavior MUST begin with a change to the ontology, not the other way around. The workflow is:

1. Identify the semantic change needed (new capability, renamed class, etc.).
2. Classify the change as MAJOR/MINOR/PATCH (Section 2.1).
3. Update the ontology files (`ontology.ttl`, `shapes.ttl`, `context.jsonld`).
4. Register the new version in `registry/index.json`.
5. Write the migration script (if MAJOR).
6. Update agent specs to use the new terms.
7. Run `tori generate` to recompile all agents.
8. Run `tori ontology validate` to confirm no drift.

Updating agent specs before updating the ontology is an anti-pattern that guarantees drift.

### 8.2 Automated Drift Checks in CI

`tori ontology validate` MUST be run as a CI step on every pull request. The CI configuration should:

```yaml
# Example GitHub Actions step
- name: Validate ontological consistency
  run: |
    npm run build
    node packages/cli/dist/cli.js generate
    node packages/cli/dist/cli.js ontology validate
```

The step exits with code 1 if any violations are found, blocking the merge. Warnings are printed but do not block the merge.

### 8.3 Deprecation Period

Terms MUST be deprecated for at least one MINOR version before removal. This gives consumers a migration window of at least one release cycle. The deprecation process:

1. Add `owl:deprecated "true"^^xsd:boolean` to the term in `ontology.ttl`.
2. Add `tori:replacedBy <replacement>` if a replacement exists.
3. Update `rdfs:comment` to explain the deprecation.
4. Add a SHACL `sh:Warning` severity constraint that fires when the deprecated term is used.
5. Record the deprecation in the version's `changelog.md`.

The SHACL warning ensures that existing instances produce visible warnings during validation, prompting migration before the term is removed.

### 8.4 Agent Spec Linting

An ESLint-style linting rule (to be implemented as part of the CLI) scans agent spec YAML files for ontology term references and validates them against the active registry. This is the static analysis component of the drift detection mechanism (Section 4.2.1).

The linter is invoked as part of `npm run lint` and produces output in the same format as ESLint:

```
packages/core/spec/agents/specialist-software-engineer.yaml
  14:5  warning  tori:hasSkill is deprecated; use tori:usesSkill  ontology/no-deprecated-terms
  22:3  error    tori:SpecialistAgent was renamed to tori:AutomatedAgent  ontology/no-removed-terms

✖ 2 problems (1 error, 1 warning)
```

### 8.5 Immutable Version Snapshots

Once a version directory (`registry/versions/<semver>/`) is committed and tagged in git, its files MUST NOT be modified. Any correction — even a typo fix in a comment — requires a new PATCH version. This invariant is enforced by:

1. **Checksum verification:** `OntologyRegistry` verifies SHA-256 checksums on startup and throws `OntologyIntegrityError` if any file has been modified.
2. **Git tag protection:** The git tag `ontology/v<semver>` is created when a version is released and MUST NOT be moved or deleted.
3. **CI check:** A CI step verifies that no files under `registry/versions/` have been modified relative to their tagged commit.

### 8.6 Version Pinning in Instance Documents

Instance documents SHOULD use version-pinned context URIs (Section 2.2.2) rather than the canonical (always-latest) URI. This ensures that the document's semantics are stable even if the active ontology version changes. The harness uses the `tori:ontologyVersion` field (not the context URI) for compatibility checking, but the pinned URI provides an additional layer of reproducibility.

---

## 9. Governance Model

### 9.1 Who Can Change the Ontology

The ontology is a shared contract between all agents, the harness, and the knowledge graph. Changes to it affect the entire system. The governance model reflects this:

| Change Type | Minimum Approval | Additional Requirements |
|-------------|-----------------|------------------------|
| **PATCH** | Any contributor via PR | Standard code review |
| **MINOR** | 1 architect review | Changelog entry, deprecation annotations if applicable |
| **MAJOR** | 2 architect reviews | ADR required, migration script required, `tori ontology validate` must pass on all existing knowledge graphs |

### 9.2 Change Process

The full change process for an ontology modification:

#### Step 1: Open an Issue

Create a GitHub issue describing:
- The proposed change (what term is being added, removed, or modified)
- The motivation (why this change is needed)
- The impact (which agents, workflows, or knowledge graphs are affected)
- The proposed classification (MAJOR/MINOR/PATCH)

#### Step 2: Classify the Change

Apply the classification rules from Section 2.1. If there is disagreement about the classification, err on the side of the higher bump (MAJOR > MINOR > PATCH). The classification determines the approval requirements.

#### Step 3: Write the ADR (MAJOR only)

For MAJOR changes, write an Architecture Decision Record (ADR) in `docs/adr/` following the project's ADR template. The ADR must document:
- The context and problem statement
- The decision (what is changing)
- The consequences (what breaks, what must be migrated)
- The migration strategy

#### Step 4: Implement the Change

1. Update `ontology.ttl` (add/remove/modify terms).
2. Update `shapes.ttl` (add/remove/modify SHACL shapes).
3. Update `context.jsonld` (add/remove/modify JSON-LD term mappings).
4. Write the migration script (MAJOR changes) or additive defaults script (MINOR changes).
5. Compute SHA-256 checksums for the new files.
6. Register the new version in `registry/index.json`.
7. Create the version directory under `registry/versions/<new-semver>/`.

#### Step 5: Validate

Run the full validation suite:

```bash
npm run build
node packages/cli/dist/cli.js generate
node packages/cli/dist/cli.js ontology validate
npm run lint
```

All checks must pass before the PR is submitted.

#### Step 6: Merge and Tag

After approval, merge the PR and create a git tag:

```bash
git tag ontology/v<semver>
git push origin ontology/v<semver>
```

### 9.3 Retirement Policy

Versions follow a lifecycle: `preview` → `active` → `stable` → `deprecated` → `retired`.

| Transition | Trigger | Effect |
|-----------|---------|--------|
| `preview` → `active` | New version released | Previous active version becomes `stable` |
| `stable` → `deprecated` | Two MINOR versions have been released since | Harness logs deprecation warning |
| `deprecated` → `retired` | One MAJOR version has been released since | Harness rejects instances with this version |

Retired versions are never deleted from the registry — they remain as historical records. Their files remain in `registry/versions/` but are no longer verified by the checksum check (to avoid bloating startup time).

---

## 10. Conformance Checklist

The following items define the expected conformance state of a correctly implemented ontology registry. Items marked **[NORMATIVE]** are required for the system to be considered conformant. Items marked **[RECOMMENDED]** are strongly advised but not strictly required.

### 10.1 Registry Structure

- **[NORMATIVE]** `packages/ontology/registry/index.json` exists and is valid JSON.
- **[NORMATIVE]** `registry/index.json` contains an `activeVersion` field that references a version present in the `versions` map.
- **[NORMATIVE]** Every version in `registry/index.json` has a corresponding directory under `registry/versions/<semver>/`.
- **[NORMATIVE]** Every version directory contains `ontology.ttl`, `shapes.ttl`, `context.jsonld`, and `changelog.md`.
- **[NORMATIVE]** SHA-256 checksums in `registry/index.json` match the actual file contents for all active and stable versions.
- **[NORMATIVE]** Every MAJOR version has a `migration.ts` file in its version directory.
- **[RECOMMENDED]** Every MINOR version has a `migration.ts` file that applies additive defaults.

### 10.2 Version Metadata

- **[NORMATIVE]** Every version's `ontology.ttl` declares `owl:versionIRI` matching the pattern `https://tori-agent.dev/ontology/2026/core/<semver>`.
- **[NORMATIVE]** Every version's `context.jsonld` is a valid JSON-LD 1.1 context document.
- **[NORMATIVE]** The `compatibleWith` array for each version correctly reflects the compatibility rules in Section 2.3.
- **[RECOMMENDED]** Every version's `stats` object accurately reflects the content of the ontology files.

### 10.3 Instance Documents

- **[NORMATIVE]** Every JSON-LD instance document produced by the harness includes a `tori:ontologyVersion` field.
- **[NORMATIVE]** The harness rejects instance documents whose `tori:ontologyVersion` is in the `breakingFrom` array of the active ontology version.
- **[RECOMMENDED]** Instance documents use version-pinned context URIs rather than the canonical (always-latest) URI.

### 10.4 Drift Detection

- **[NORMATIVE]** `tori ontology validate` runs without errors on the current `.opencode/` directory.
- **[NORMATIVE]** `tori ontology validate` exits with code 1 if any violations are found.
- **[RECOMMENDED]** `tori ontology validate` is run as a CI step on every pull request.
- **[RECOMMENDED]** The agent spec linter is integrated into `npm run lint`.

### 10.5 Capability Manifest

- **[NORMATIVE]** `capabilities.json` is regenerated on every `tori generate` run.
- **[NORMATIVE]** `capabilities.json` includes a `capabilityIndex` reverse map.
- **[NORMATIVE]** `capabilities.json` records the `ontologyVersion` under which it was generated.
- **[RECOMMENDED]** The harness detects and warns about stale capability manifests.

### 10.6 Migration

- **[NORMATIVE]** All MAJOR version bumps have a migration script that implements the `OntologyMigration` interface.
- **[NORMATIVE]** Migration scripts pass their own `validate()` check after `migrate()` is applied.
- **[RECOMMENDED]** `MigrationRunner.dryRun()` is called and reviewed before `execute()` is called in production.
- **[RECOMMENDED]** Migration checkpoints are saved before executing any migration.

### 10.7 Governance

- **[NORMATIVE]** Deprecated terms are present for at least one MINOR version before removal.
- **[NORMATIVE]** MAJOR changes have an ADR in `docs/adr/`.
- **[RECOMMENDED]** Version git tags (`ontology/v<semver>`) are created for every released version.
- **[RECOMMENDED]** Retired version files are retained in `registry/versions/` for historical reference.

---

## 11. Related Specs

| Spec | Title | Status | Relationship |
|------|-------|--------|--------------|
| SC-01 | Ontology Schema — Core Classes & Properties | draft | Informative dependency — the registry manages versions of the SC-01 ontology. The 12 classes and 48 properties defined in SC-01 are the terms that the registry tracks, versions, and validates against. |
| SC-02 | SHACL Shapes | draft | Informative dependency — SHACL shapes are co-versioned with the ontology. Each version snapshot in the registry includes a `shapes.ttl` file that is the SC-02 snapshot for that version. |
| SC-03 | Datalog Policy Engine | draft | Informative dependency — Datalog rules are not versioned separately; they are considered part of the ontology version and are updated when the ontology changes. |
| SC-04 | JSON-LD Context & Serialization | draft | Informative dependency — context versioning follows the registry. The `contextURI` field in each registry version entry points to the SC-04 context snapshot for that version. The `tori:ontologyVersion` property defined in SC-04 is the instance version identifier used by the registry's compatibility check. |

---

## Appendix A: Registry JSON Schema

The following JSON Schema (Draft 2020-12) formally defines the structure of `registry/index.json`. Implementations MAY use this schema for validation.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tori-agent.dev/ontology/registry-index-schema.json",
  "title": "Ontology Registry Index",
  "description": "Machine-readable manifest of all registered tori-agent ontology versions.",
  "type": "object",
  "required": ["$schema", "activeVersion", "latestStableVersion", "updatedAt", "versions"],
  "properties": {
    "$schema": { "type": "string", "format": "uri" },
    "activeVersion": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "The currently active ontology version."
    },
    "latestStableVersion": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "The latest stable (non-preview) version."
    },
    "latestPreviewVersion": {
      "oneOf": [
        { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
        { "type": "null" }
      ],
      "description": "The latest preview version, or null if none."
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp of the last registry update."
    },
    "versions": {
      "type": "object",
      "description": "Map from semantic version string to version metadata.",
      "patternProperties": {
        "^\\d+\\.\\d+\\.\\d+$": {
          "$ref": "#/$defs/OntologyVersion"
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false,
  "$defs": {
    "OntologyVersion": {
      "type": "object",
      "required": [
        "status", "stability", "releasedAt", "ontologyIRI", "versionIRI",
        "contextURI", "compatibleWith", "breakingFrom", "migrationRequired",
        "files", "checksum", "stats", "changelog"
      ],
      "properties": {
        "status": {
          "type": "string",
          "enum": ["active", "stable", "deprecated", "retired", "preview"]
        },
        "stability": {
          "type": "string",
          "enum": ["stable", "preview", "experimental"]
        },
        "releasedAt": { "type": "string", "format": "date-time" },
        "deprecatedAt": { "oneOf": [{ "type": "string", "format": "date-time" }, { "type": "null" }] },
        "retiredAt": { "oneOf": [{ "type": "string", "format": "date-time" }, { "type": "null" }] },
        "ontologyIRI": { "type": "string", "format": "uri" },
        "versionIRI": { "type": "string", "format": "uri" },
        "contextURI": { "type": "string", "format": "uri" },
        "compatibleWith": {
          "type": "array",
          "items": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" }
        },
        "breakingFrom": {
          "type": "array",
          "items": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" }
        },
        "migrationRequired": { "type": "boolean" },
        "files": {
          "type": "object",
          "required": ["ontology", "shapes", "context", "changelog"],
          "properties": {
            "ontology": { "type": "string" },
            "shapes": { "type": "string" },
            "context": { "type": "string" },
            "changelog": { "type": "string" },
            "migration": { "type": "string" }
          },
          "additionalProperties": false
        },
        "checksum": {
          "type": "object",
          "required": ["algorithm", "ontology", "shapes", "context"],
          "properties": {
            "algorithm": { "type": "string", "enum": ["sha256"] },
            "ontology": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
            "shapes": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
            "context": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
          },
          "additionalProperties": false
        },
        "stats": {
          "type": "object",
          "required": ["classes", "objectProperties", "datatypeProperties", "axioms", "shaclShapes", "datalogRules"],
          "properties": {
            "classes": { "type": "integer", "minimum": 0 },
            "objectProperties": { "type": "integer", "minimum": 0 },
            "datatypeProperties": { "type": "integer", "minimum": 0 },
            "axioms": { "type": "integer", "minimum": 0 },
            "shaclShapes": { "type": "integer", "minimum": 0 },
            "datalogRules": { "type": "integer", "minimum": 0 }
          },
          "additionalProperties": false
        },
        "changelog": {
          "type": "object",
          "required": ["summary", "breaking", "added", "deprecated", "fixed"],
          "properties": {
            "summary": { "type": "string" },
            "breaking": { "type": "array", "items": { "type": "string" } },
            "added": { "type": "array", "items": { "type": "string" } },
            "deprecated": { "type": "array", "items": { "type": "string" } },
            "fixed": { "type": "array", "items": { "type": "string" } }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
  }
}
```

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Active version** | The ontology version currently deployed in the harness. All new instance documents MUST use this version. |
| **Capability manifest** | The `capabilities.json` file generated by `tori generate`, containing the pre-computed capability and role indexes for O(1) dispatch. |
| **Compatibility matrix** | The `compatibleWith` and `breakingFrom` arrays in `registry/index.json` that encode which instance versions are valid against which ontology versions. |
| **Context version** | The version of the JSON-LD `@context` document, co-versioned with the ontology schema. |
| **Drift** | The condition where the live system state diverges from the declared active ontology. See Section 4.1. |
| **Instance version** | The value of the `tori:ontologyVersion` property on an instance document, indicating which ontology version the document was compiled against. |
| **Migration** | A transformation applied to a JSON-LD graph to make it compatible with a newer ontology version. Required for MAJOR bumps; optional for MINOR bumps. |
| **Ontological drift** | See "Drift". |
| **Registry** | The directory structure under `packages/ontology/registry/` and the `OntologyRegistry` TypeScript class that provides programmatic access to it. |
| **Schema version** | The version of the OWL ontology file (`ontology.ttl`), identified by `owl:versionIRI`. |
| **Semantic versioning** | The MAJOR.MINOR.PATCH versioning scheme defined at semver.org, adapted for ontologies in Section 2.1. |
| **Version snapshot** | The set of files (`ontology.ttl`, `shapes.ttl`, `context.jsonld`) that constitute a specific ontology version, stored immutably in `registry/versions/<semver>/`. |
