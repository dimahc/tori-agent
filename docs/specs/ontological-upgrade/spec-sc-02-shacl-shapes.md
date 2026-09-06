---
title: "[Spec-SC-02] SHACL Shapes for Ontology Validation"
status: draft
created: "2026-09-06"
spec_id: SC-02
domain: ontology/reasoning
version: "0.1.0"
authors:
  - Lead Systems Architect
related_specs:
  - SC-01: Ontology Schema (normative dependency)
  - SC-03: Datalog Policy Engine (normative companion)
---

# [Spec-SC-02] SHACL Shapes for Ontology Validation

---

## 1. Executive Summary

### 1.1 Purpose of SHACL in the Neuro-symbolic Triad

The tori-agent system is built on a **Neuro-symbolic Triad** — three complementary layers that together provide formal semantics, structural validation, and operational policy enforcement:

| Layer | Technology | Role | Spec |
|-------|-----------|------|------|
| **Tier 1 — Semantic Core** | JSON-LD / OWL 2 DL | Defines meaning: class hierarchy, property semantics, inference axioms | SC-01 |
| **Tier 2 — Reasoning Engine** | SHACL (Shapes Constraint Language) | Validates structure: cardinality, type constraints, cross-entity rules | **SC-02 (this spec)** |
| **Tier 3 — Policy Engine** | Datalog (Soufflé dialect) | Enforces operational rules: capability propagation, permission monotonicity | SC-03 |

SHACL occupies the critical middle tier. While OWL (SC-01) defines *what things are*, SHACL defines *what valid instances look like*. SHACL shapes are **closed-world constraints** — they reject instances that violate structural rules, even when OWL reasoning would accept them under the open-world assumption.

This distinction is architecturally significant: OWL reasoning is monotonic and open-world; SHACL validation is closed-world and blocking. The combination gives the system both the inferential power of description logics and the practical safety of schema validation.

### 1.2 Relationship to SC-01

SC-02 is the **normative companion** to SC-01. Every class defined in SC-01 has a corresponding SHACL shape defined here. The relationship is:

- SC-01 defines `tori:Agent` as an OWL class with properties `tori:hasRole`, `tori:hasTool`, etc.
- SC-02 defines `tori:AgentShape` which enforces that every `tori:Agent` instance **must** have at least one `tori:hasRole`, that `tori:assignedTo` is exactly 1, and so on.

SC-01 is a **normative dependency** of SC-02: the shapes reference SC-01 class IRIs and property IRIs. If SC-01 changes a class name or property IRI, SC-02 must be updated to match.

### 1.3 Validation Lifecycle

SHACL validation is triggered at two points in the tori-agent execution lifecycle:

1. **On mutation** — whenever an agent writes or updates an ontological instance (e.g., creates a new `tori:Artifact`, registers a `tori:Tool`), the harness validates the mutated subgraph against the relevant shape before committing the change.

2. **On verify stage entry** — at the start of every `verify` workflow stage, the full RDF dataset is validated against all 12 shapes. Any `sh:Violation` result blocks the stage transition. `sh:Warning` results are logged but do not block.

The validation pipeline is:

```
JSON-LD document
      │
      ▼
RDF Dataset (N-Quads)
      │
      ▼
SHACL Validator (rdf-validate-shacl)
      │
      ├── ValidationReport
      │     ├── sh:conforms: true  → proceed
      │     └── sh:conforms: false
      │           ├── sh:Violation → BLOCK (throw ValidationError)
      │           └── sh:Warning   → LOG (continue with warning)
      │
      ▼
Structured TypeScript errors / success
```

### 1.4 Shape Summary Table

| Shape Name | Target Class | Property Constraints | SPARQL Constraints | Severity |
|-----------|-------------|---------------------|-------------------|---------|
| `tori:AgentShape` | `tori:Agent` | 6 | 0 | Violation + Warning |
| `tori:RoleShape` | `tori:Role` | 4 | 0 | Violation |
| `tori:CapabilityShape` | `tori:Capability` | 4 | 0 | Violation |
| `tori:SkillShape` | `tori:Skill` | 5 | 0 | Violation |
| `tori:ToolShape` | `tori:Tool` | 5 | 0 | Violation |
| `tori:TaskShape` | `tori:Task` | 6 | 0 | Violation |
| `tori:WorkflowShape` | `tori:Workflow` | 4 | 0 | Violation |
| `tori:StageShape` | `tori:Stage` | 3 | 0 | Violation |
| `tori:TransitionShape` | `tori:Transition` | 4 | 1 (C6) | Violation |
| `tori:ArtifactShape` | `tori:Artifact` | 5 | 1 (C7) | Violation |
| `tori:KnowledgeShape` | `tori:Knowledge` | 4 | 0 | Violation + Warning |
| `tori:PolicyShape` | `tori:Policy` | 5 | 0 | Violation |

---

## 2. SHACL Primer

This section provides a concise reference for readers unfamiliar with SHACL. Readers already familiar with SHACL may skip to Section 3.

### 2.1 NodeShape vs PropertyShape

SHACL has two fundamental shape types:

**NodeShape** (`sh:NodeShape`) targets a set of RDF nodes (typically all instances of a class) and applies a collection of constraints to each targeted node. In this spec, every class gets one NodeShape.

```turtle
tori:AgentShape
    a sh:NodeShape ;
    sh:targetClass tori:Agent ;
    sh:property [ ... ] ;
    sh:property [ ... ] .
```

**PropertyShape** (`sh:PropertyShape`) constrains a specific property path on the targeted node. PropertyShapes are typically embedded inline within a NodeShape using `sh:property`.

```turtle
sh:property [
    sh:path tori:hasRole ;
    sh:minCount 1 ;
    sh:class tori:Role ;
    sh:severity sh:Violation ;
    sh:message "An Agent must have at least one Role." ;
] ;
```

### 2.2 Core SHACL Vocabulary

| Term | Meaning |
|------|---------|
| `sh:targetClass` | All instances of this OWL class are targeted by the shape |
| `sh:path` | The property (or property path) being constrained |
| `sh:minCount` | Minimum number of values the property must have |
| `sh:maxCount` | Maximum number of values the property may have |
| `sh:datatype` | The XSD datatype the value must conform to |
| `sh:class` | The RDF class the value node must be an instance of |
| `sh:nodeKind` | The kind of RDF node: `sh:IRI`, `sh:BlankNode`, `sh:Literal`, etc. |
| `sh:in` | The value must be one of a specified list (enumeration) |
| `sh:minInclusive` / `sh:maxInclusive` | Numeric range constraints |
| `sh:pattern` | The string value must match a regular expression |
| `sh:sparql` | A SPARQL SELECT query that returns violation bindings |
| `sh:message` | Human-readable violation message (supports `{$value}` substitution) |

### 2.3 Severity Levels

SHACL defines three severity levels, used in this spec as follows:

| Severity | SHACL Term | Meaning in tori-agent | Blocking? |
|---------|-----------|----------------------|-----------|
| **Violation** | `sh:Violation` | Structural invariant broken — instance is invalid | **Yes** — harness throws `ValidationError` |
| **Warning** | `sh:Warning` | Best-practice deviation — instance is technically valid but suspicious | No — logged to `warn` channel |
| **Info** | `sh:Info` | Informational note — no action required | No — logged to `debug` channel |

### 2.4 SPARQL-Based Constraints

For constraints that cannot be expressed with standard SHACL property constraints — particularly cross-entity rules like C6 (Transition Validity) and C7 (Review Independence) — SHACL supports embedding SPARQL SELECT queries via `sh:sparql`:

```turtle
sh:sparql [
    a sh:SPARQLConstraint ;
    sh:message "Violation message: {$this}" ;
    sh:severity sh:Violation ;
    sh:select """
        PREFIX tori: <https://tori-agent.dev/ontology/2026/core#>
        SELECT $this
        WHERE {
            $this tori:someProperty ?value .
            FILTER ( ... )
        }
    """ ;
] ;
```

The query must use `$this` to refer to the focus node. Any row returned by the SELECT is treated as a violation. The `{$this}` placeholder in `sh:message` is substituted with the IRI of the violating node.

### 2.5 Prefix Declarations

All Turtle blocks in this spec use the following prefix declarations (not repeated per block for brevity):

```turtle
@prefix tori:  <https://tori-agent.dev/ontology/2026/core#> .
@prefix sh:    <http://www.w3.org/ns/shacl#> .
@prefix owl:   <http://www.w3.org/2002/07/owl#> .
@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
```

---

## 3. Shape Definitions

### 3.1 `tori:AgentShape`

**Target class:** `tori:Agent`
**Axioms enforced:** C3 (partial — producedBy inverse), C5 (partial — tool binding)

#### Turtle Definition

```turtle
tori:AgentShape
    a sh:NodeShape ;
    sh:targetClass tori:Agent ;
    rdfs:label "Agent Shape" ;
    rdfs:comment "Validates structural constraints on tori:Agent instances." ;

    # P1 — agentId: exactly 1 xsd:string, IRI-safe pattern
    sh:property [
        sh:path tori:agentId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Agent must have exactly one agentId conforming to UUID v4 format." ;
    ] ;

    # P2 — agentName: exactly 1 non-empty string
    sh:property [
        sh:path tori:agentName ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 1 ;
        sh:severity sh:Violation ;
        sh:message "Agent must have exactly one non-empty agentName." ;
    ] ;

    # P3 — hasRole: at least 1 Role (Axiom: every agent must have a role)
    sh:property [
        sh:path tori:hasRole ;
        sh:minCount 1 ;
        sh:class tori:Role ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Agent '{$this}' must have at least one tori:hasRole pointing to a tori:Role." ;
    ] ;

    # P4 — hasTool: if present, must point to tori:Tool instances
    sh:property [
        sh:path tori:hasTool ;
        sh:class tori:Tool ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Agent '{$this}' hasTool must reference a tori:Tool instance." ;
    ] ;

    # P5 — effectivelyHasCapability: warning if empty (inferred by Datalog, not asserted)
    sh:property [
        sh:path tori:effectivelyHasCapability ;
        sh:class tori:Capability ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Warning ;
        sh:message "Agent '{$this}' has no effectivelyHasCapability — check Role→Capability chain." ;
    ] ;

    # P6 — hasKnowledge: if present, must point to tori:Knowledge instances
    sh:property [
        sh:path tori:hasKnowledge ;
        sh:class tori:Knowledge ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Agent '{$this}' hasKnowledge must reference a tori:Knowledge instance." ;
    ] .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | agentId | `tori:agentId` | exactly 1, UUID v4 pattern | Violation | Globally unique identifier |
| P2 | agentName | `tori:agentName` | exactly 1, non-empty string | Violation | Human-readable name |
| P3 | hasRole | `tori:hasRole` | min 1, class=Role | Violation | Every agent must have a role |
| P4 | hasTool | `tori:hasTool` | class=Tool (if present) | Violation | Tool references must be valid |
| P5 | effectivelyHasCapability | `tori:effectivelyHasCapability` | class=Capability (if present) | Warning | Inferred by Datalog; warn if absent |
| P6 | hasKnowledge | `tori:hasKnowledge` | class=Knowledge (if present) | Violation | Knowledge references must be valid |

#### Validation Examples

**Valid instance:**
```turtle
tori:agent-001
    a tori:Agent ;
    tori:agentId "550e8400-e29b-41d4-a716-446655440000" ;
    tori:agentName "Specialist-Alpha" ;
    tori:hasRole tori:role-executor ;
    tori:hasTool tori:tool-filesystem .
```
*Result: `sh:conforms true`*

**Invalid instance (missing hasRole):**
```turtle
tori:agent-002
    a tori:Agent ;
    tori:agentId "550e8400-e29b-41d4-a716-446655440001" ;
    tori:agentName "Orphan Agent" .
    # Missing tori:hasRole
```
*Expected violation:* `sh:resultMessage "Agent 'tori:agent-002' must have at least one tori:hasRole pointing to a tori:Role."` at path `tori:hasRole`, severity `sh:Violation`.

---

### 3.2 `tori:RoleShape`

**Target class:** `tori:Role`
**Axioms enforced:** C1 (partial — requiresCapability must be present for transitivity to apply)

#### Turtle Definition

```turtle
tori:RoleShape
    a sh:NodeShape ;
    sh:targetClass tori:Role ;
    rdfs:label "Role Shape" ;
    rdfs:comment "Validates structural constraints on tori:Role instances." ;

    # P1 — roleId: exactly 1 UUID v4
    sh:property [
        sh:path tori:roleId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Role must have exactly one roleId conforming to UUID v4 format." ;
    ] ;

    # P2 — roleName: exactly 1 non-empty string
    sh:property [
        sh:path tori:roleName ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 1 ;
        sh:severity sh:Violation ;
        sh:message "Role must have exactly one non-empty roleName." ;
    ] ;

    # P3 — requiresCapability: at least 1 (enables C1 Capability Transitivity)
    sh:property [
        sh:path tori:requiresCapability ;
        sh:minCount 1 ;
        sh:class tori:Capability ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Role '{$this}' must require at least one tori:Capability (needed for C1 transitivity)." ;
    ] ;

    # P4 — roleDescription: at most 1 string (optional but typed if present)
    sh:property [
        sh:path tori:roleDescription ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:severity sh:Violation ;
        sh:message "Role '{$this}' roleDescription must be a single xsd:string if present." ;
    ] .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | roleId | `tori:roleId` | exactly 1, UUID v4 | Violation | Unique role identifier |
| P2 | roleName | `tori:roleName` | exactly 1, non-empty | Violation | Human-readable name |
| P3 | requiresCapability | `tori:requiresCapability` | min 1, class=Capability | Violation | Enables C1 transitivity |
| P4 | roleDescription | `tori:roleDescription` | max 1, xsd:string | Violation | Optional description |

#### Validation Examples

**Valid instance:**
```turtle
tori:role-executor
    a tori:Role ;
    tori:roleId "660e8400-e29b-41d4-a716-446655440000" ;
    tori:roleName "Executor" ;
    tori:requiresCapability tori:cap-file-read, tori:cap-code-write ;
    tori:roleDescription "Executes assigned tasks using file and code capabilities." .
```
*Result: `sh:conforms true`*

**Invalid instance (no requiresCapability):**
```turtle
tori:role-empty
    a tori:Role ;
    tori:roleId "660e8400-e29b-41d4-a716-446655440001" ;
    tori:roleName "EmptyRole" .
    # Missing tori:requiresCapability
```
*Expected violation:* `sh:resultMessage "Role 'tori:role-empty' must require at least one tori:Capability (needed for C1 transitivity)."` at path `tori:requiresCapability`, severity `sh:Violation`.

---

### 3.3 `tori:CapabilityShape`

**Target class:** `tori:Capability`
**Axioms enforced:** C5 (partial — at least one Tool must bind this Capability, checked via inverse)

#### Turtle Definition

```turtle
tori:CapabilityShape
    a sh:NodeShape ;
    sh:targetClass tori:Capability ;
    rdfs:label "Capability Shape" ;
    rdfs:comment "Validates structural constraints on tori:Capability instances." ;

    # P1 — capabilityId: exactly 1 UUID v4
    sh:property [
        sh:path tori:capabilityId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Capability must have exactly one capabilityId conforming to UUID v4 format." ;
    ] ;

    # P2 — capabilityName: exactly 1 non-empty string
    sh:property [
        sh:path tori:capabilityName ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 1 ;
        sh:severity sh:Violation ;
        sh:message "Capability must have exactly one non-empty capabilityName." ;
    ] ;

    # P3 — capabilityDescription: exactly 1 string (required for discoverability)
    sh:property [
        sh:path tori:capabilityDescription ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 10 ;
        sh:severity sh:Violation ;
        sh:message "Capability '{$this}' must have a capabilityDescription of at least 10 characters." ;
    ] ;

    # P4 — capabilityType: exactly 1, from controlled vocabulary
    sh:property [
        sh:path tori:capabilityType ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:in ( "tool" "reasoning" "domain" "composite" ) ;
        sh:severity sh:Violation ;
        sh:message "Capability '{$this}' capabilityType must be one of: tool, reasoning, domain, composite." ;
    ] .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | capabilityId | `tori:capabilityId` | exactly 1, UUID v4 | Violation | Unique identifier |
| P2 | capabilityName | `tori:capabilityName` | exactly 1, non-empty | Violation | Human-readable name |
| P3 | capabilityDescription | `tori:capabilityDescription` | exactly 1, min 10 chars | Violation | Required for discoverability |
| P4 | capabilityType | `tori:capabilityType` | exactly 1, enum | Violation | Controlled vocabulary |

#### Validation Examples

**Valid instance:**
```turtle
tori:cap-file-read
    a tori:Capability ;
    tori:capabilityId "770e8400-e29b-41d4-a716-446655440000" ;
    tori:capabilityName "FileRead" ;
    tori:capabilityDescription "Ability to read files from the local filesystem." ;
    tori:capabilityType "tool" .
```
*Result: `sh:conforms true`*

**Invalid instance (description too short):**
```turtle
tori:cap-bad
    a tori:Capability ;
    tori:capabilityId "770e8400-e29b-41d4-a716-446655440001" ;
    tori:capabilityName "Bad" ;
    tori:capabilityDescription "Short" ;
    tori:capabilityType "tool" .
```
*Expected violation:* `sh:resultMessage "Capability 'tori:cap-bad' must have a capabilityDescription of at least 10 characters."` at path `tori:capabilityDescription`, severity `sh:Violation`.

---

### 3.4 `tori:SkillShape`

**Target class:** `tori:Skill`
**Axioms enforced:** None directly; enforces structural completeness for skill invocation

#### Turtle Definition

```turtle
tori:SkillShape
    a sh:NodeShape ;
    sh:targetClass tori:Skill ;
    rdfs:label "Skill Shape" ;
    rdfs:comment "Validates structural constraints on tori:Skill instances." ;

    # P1 — skillId: exactly 1 UUID v4
    sh:property [
        sh:path tori:skillId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Skill must have exactly one skillId conforming to UUID v4 format." ;
    ] ;

    # P2 — skillName: exactly 1 non-empty string
    sh:property [
        sh:path tori:skillName ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 1 ;
        sh:severity sh:Violation ;
        sh:message "Skill must have exactly one non-empty skillName." ;
    ] ;

    # P3 — parameterSchema: exactly 1 JSON string (schema for skill parameters)
    sh:property [
        sh:path tori:parameterSchema ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:severity sh:Violation ;
        sh:message "Skill '{$this}' must have exactly one parameterSchema (JSON Schema string)." ;
    ] ;

    # P4 — invokesCapability: at least 1 Capability (skills must invoke something)
    sh:property [
        sh:path tori:invokesCapability ;
        sh:minCount 1 ;
        sh:class tori:Capability ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Skill '{$this}' must invoke at least one tori:Capability." ;
    ] ;

    # P5 — skillVersion: exactly 1 semver string
    sh:property [
        sh:path tori:skillVersion ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$" ;
        sh:severity sh:Violation ;
        sh:message "Skill '{$this}' skillVersion must be a valid semver string (e.g., '1.0.0')." ;
    ] .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | skillId | `tori:skillId` | exactly 1, UUID v4 | Violation | Unique identifier |
| P2 | skillName | `tori:skillName` | exactly 1, non-empty | Violation | Human-readable name |
| P3 | parameterSchema | `tori:parameterSchema` | exactly 1, string | Violation | JSON Schema for parameters |
| P4 | invokesCapability | `tori:invokesCapability` | min 1, class=Capability | Violation | Must invoke at least one capability |
| P5 | skillVersion | `tori:skillVersion` | exactly 1, semver pattern | Violation | Semantic version string |

#### Validation Examples

**Valid instance:**
```turtle
tori:skill-git-commit
    a tori:Skill ;
    tori:skillId "880e8400-e29b-41d4-a716-446655440000" ;
    tori:skillName "git-commit" ;
    tori:skillVersion "1.0.0" ;
    tori:parameterSchema "{\"type\":\"object\",\"properties\":{\"message\":{\"type\":\"string\"}}}" ;
    tori:invokesCapability tori:cap-git-write .
```
*Result: `sh:conforms true`*

**Invalid instance (bad version format):**
```turtle
tori:skill-bad
    a tori:Skill ;
    tori:skillId "880e8400-e29b-41d4-a716-446655440001" ;
    tori:skillName "bad-skill" ;
    tori:skillVersion "v1.0" ;
    tori:parameterSchema "{}" ;
    tori:invokesCapability tori:cap-file-read .
```
*Expected violation:* `sh:resultMessage "Skill 'tori:skill-bad' skillVersion must be a valid semver string (e.g., '1.0.0')."` at path `tori:skillVersion`, severity `sh:Violation`.

---

### 3.5 `tori:ToolShape`

**Target class:** `tori:Tool`
**Axioms enforced:** C5 — Every Tool must be bound to at least one Capability

#### Turtle Definition

```turtle
tori:ToolShape
    a sh:NodeShape ;
    sh:targetClass tori:Tool ;
    rdfs:label "Tool Shape" ;
    rdfs:comment "Validates structural constraints on tori:Tool instances. Enforces C5 (Tool-Capability Binding)." ;

    # P1 — toolId: exactly 1 UUID v4
    sh:property [
        sh:path tori:toolId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Tool must have exactly one toolId conforming to UUID v4 format." ;
    ] ;

    # P2 — toolName: exactly 1 non-empty string
    sh:property [
        sh:path tori:toolName ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 1 ;
        sh:severity sh:Violation ;
        sh:message "Tool must have exactly one non-empty toolName." ;
    ] ;

    # P3 — bindsCapability: at least 1 (C5 enforcement)
    sh:property [
        sh:path tori:bindsCapability ;
        sh:minCount 1 ;
        sh:class tori:Capability ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Tool '{$this}' must bind at least one tori:Capability (C5: Tool-Capability Binding)." ;
    ] ;

    # P4 — toolType: exactly 1, from controlled vocabulary
    sh:property [
        sh:path tori:toolType ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:in ( "mcp" "filesystem" "network" "builtin" "external" ) ;
        sh:severity sh:Violation ;
        sh:message "Tool '{$this}' toolType must be one of: mcp, filesystem, network, builtin, external." ;
    ] ;

    # P5 — toolEndpoint or commandPath: at least one must be present
    # Modeled as: (endpoint OR commandPath) min 1 combined
    sh:or (
        [
            sh:property [
                sh:path tori:toolEndpoint ;
                sh:minCount 1 ;
                sh:datatype xsd:anyURI ;
            ]
        ]
        [
            sh:property [
                sh:path tori:commandPath ;
                sh:minCount 1 ;
                sh:datatype xsd:string ;
            ]
        ]
    ) ;
    sh:message "Tool '{$this}' must have either a toolEndpoint (URI) or a commandPath (string)." ;
    sh:severity sh:Violation .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | toolId | `tori:toolId` | exactly 1, UUID v4 | Violation | Unique identifier |
| P2 | toolName | `tori:toolName` | exactly 1, non-empty | Violation | Human-readable name |
| P3 | bindsCapability | `tori:bindsCapability` | min 1, class=Capability | Violation | **C5 enforcement** |
| P4 | toolType | `tori:toolType` | exactly 1, enum | Violation | Controlled vocabulary |
| P5 | toolEndpoint / commandPath | OR constraint | at least one present | Violation | Network or local tool |

#### Validation Examples

**Valid instance (MCP tool):**
```turtle
tori:tool-filesystem
    a tori:Tool ;
    tori:toolId "990e8400-e29b-41d4-a716-446655440000" ;
    tori:toolName "FilesystemTool" ;
    tori:toolType "filesystem" ;
    tori:commandPath "/usr/local/bin/fs-tool" ;
    tori:bindsCapability tori:cap-file-read, tori:cap-file-write .
```
*Result: `sh:conforms true`*

**Invalid instance (no bindsCapability — C5 violation):**
```turtle
tori:tool-unbound
    a tori:Tool ;
    tori:toolId "990e8400-e29b-41d4-a716-446655440001" ;
    tori:toolName "UnboundTool" ;
    tori:toolType "network" ;
    tori:toolEndpoint <https://api.example.com/v1> .
    # Missing tori:bindsCapability — violates C5
```
*Expected violation:* `sh:resultMessage "Tool 'tori:tool-unbound' must bind at least one tori:Capability (C5: Tool-Capability Binding)."` at path `tori:bindsCapability`, severity `sh:Violation`.

---

### 3.6 `tori:TaskShape`

**Target class:** `tori:Task`
**Axioms enforced:** C3 (partial — assignedTo exactly 1 Agent)

#### Turtle Definition

```turtle
tori:TaskShape
    a sh:NodeShape ;
    sh:targetClass tori:Task ;
    rdfs:label "Task Shape" ;
    rdfs:comment "Validates structural constraints on tori:Task instances. Enforces C3 (partial)." ;

    # P1 — taskId: exactly 1 UUID v4
    sh:property [
        sh:path tori:taskId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Task must have exactly one taskId conforming to UUID v4 format." ;
    ] ;

    # P2 — taskName: exactly 1 non-empty string
    sh:property [
        sh:path tori:taskName ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 1 ;
        sh:severity sh:Violation ;
        sh:message "Task must have exactly one non-empty taskName." ;
    ] ;

    # P3 — assignedTo: exactly 1 Agent (C3 partial enforcement)
    sh:property [
        sh:path tori:assignedTo ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:class tori:Agent ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Task '{$this}' must be assigned to exactly one tori:Agent (C3: Producer Completeness)." ;
    ] ;

    # P4 — taskStatus: exactly 1, from controlled vocabulary
    sh:property [
        sh:path tori:taskStatus ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:in ( "pending" "in-progress" "blocked" "completed" "cancelled" "failed" ) ;
        sh:severity sh:Violation ;
        sh:message "Task '{$this}' taskStatus must be one of: pending, in-progress, blocked, completed, cancelled, failed." ;
    ] ;

    # P5 — governedBy: if present, must point to tori:Policy
    sh:property [
        sh:path tori:governedBy ;
        sh:class tori:Policy ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Task '{$this}' governedBy must reference a tori:Policy instance." ;
    ] ;

    # P6 — producedArtifact: if present, must point to tori:Artifact
    sh:property [
        sh:path tori:producedArtifact ;
        sh:class tori:Artifact ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Task '{$this}' producedArtifact must reference a tori:Artifact instance." ;
    ] .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | taskId | `tori:taskId` | exactly 1, UUID v4 | Violation | Unique identifier |
| P2 | taskName | `tori:taskName` | exactly 1, non-empty | Violation | Human-readable name |
| P3 | assignedTo | `tori:assignedTo` | exactly 1, class=Agent | Violation | **C3 partial enforcement** |
| P4 | taskStatus | `tori:taskStatus` | exactly 1, enum | Violation | Controlled vocabulary |
| P5 | governedBy | `tori:governedBy` | class=Policy (if present) | Violation | Optional policy reference |
| P6 | producedArtifact | `tori:producedArtifact` | class=Artifact (if present) | Violation | Optional output artifact |

#### Validation Examples

**Valid instance:**
```turtle
tori:task-write-spec
    a tori:Task ;
    tori:taskId "aa0e8400-e29b-41d4-a716-446655440000" ;
    tori:taskName "Write SC-02 Specification" ;
    tori:assignedTo tori:agent-001 ;
    tori:taskStatus "in-progress" ;
    tori:producedArtifact tori:artifact-spec-sc-02 .
```
*Result: `sh:conforms true`*

**Invalid instance (invalid status value):**
```turtle
tori:task-bad
    a tori:Task ;
    tori:taskId "aa0e8400-e29b-41d4-a716-446655440001" ;
    tori:taskName "Bad Task" ;
    tori:assignedTo tori:agent-001 ;
    tori:taskStatus "running" .  # Not in controlled vocabulary
```
*Expected violation:* `sh:resultMessage "Task 'tori:task-bad' taskStatus must be one of: pending, in-progress, blocked, completed, cancelled, failed."` at path `tori:taskStatus`, severity `sh:Violation`.

---

### 3.7 `tori:WorkflowShape`

**Target class:** `tori:Workflow`
**Axioms enforced:** C6 (partial — hasStage min 2 ensures transitions can be valid)

#### Turtle Definition

```turtle
tori:WorkflowShape
    a sh:NodeShape ;
    sh:targetClass tori:Workflow ;
    rdfs:label "Workflow Shape" ;
    rdfs:comment "Validates structural constraints on tori:Workflow instances." ;

    # P1 — workflowId: exactly 1 UUID v4
    sh:property [
        sh:path tori:workflowId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Workflow must have exactly one workflowId conforming to UUID v4 format." ;
    ] ;

    # P2 — workflowName: exactly 1 non-empty string
    sh:property [
        sh:path tori:workflowName ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 1 ;
        sh:severity sh:Violation ;
        sh:message "Workflow must have exactly one non-empty workflowName." ;
    ] ;

    # P3 — hasStage: at least 2 Stages (a workflow with 0 or 1 stages cannot have transitions)
    sh:property [
        sh:path tori:hasStage ;
        sh:minCount 2 ;
        sh:class tori:Stage ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Workflow '{$this}' must have at least 2 tori:Stage instances (C6 prerequisite)." ;
    ] ;

    # P4 — hasTransition: if present, must point to tori:Transition
    sh:property [
        sh:path tori:hasTransition ;
        sh:class tori:Transition ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Workflow '{$this}' hasTransition must reference a tori:Transition instance." ;
    ] .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | workflowId | `tori:workflowId` | exactly 1, UUID v4 | Violation | Unique identifier |
| P2 | workflowName | `tori:workflowName` | exactly 1, non-empty | Violation | Human-readable name |
| P3 | hasStage | `tori:hasStage` | min 2, class=Stage | Violation | C6 prerequisite |
| P4 | hasTransition | `tori:hasTransition` | class=Transition (if present) | Violation | Optional transition references |

#### Validation Examples

**Valid instance:**
```turtle
tori:workflow-ontology-upgrade
    a tori:Workflow ;
    tori:workflowId "bb0e8400-e29b-41d4-a716-446655440000" ;
    tori:workflowName "Ontological Upgrade Workflow" ;
    tori:hasStage tori:stage-plan, tori:stage-execute, tori:stage-verify ;
    tori:hasTransition tori:transition-plan-to-execute .
```
*Result: `sh:conforms true`*

**Invalid instance (only 1 stage):**
```turtle
tori:workflow-bad
    a tori:Workflow ;
    tori:workflowId "bb0e8400-e29b-41d4-a716-446655440001" ;
    tori:workflowName "Single Stage Workflow" ;
    tori:hasStage tori:stage-plan .  # Only 1 stage — violates min 2
```
*Expected violation:* `sh:resultMessage "Workflow 'tori:workflow-bad' must have at least 2 tori:Stage instances (C6 prerequisite)."` at path `tori:hasStage`, severity `sh:Violation`.

---

### 3.8 `tori:StageShape`

**Target class:** `tori:Stage`
**Axioms enforced:** C6 (partial — belongsToWorkflow exactly 1 ensures stages are not orphaned)

#### Turtle Definition

```turtle
tori:StageShape
    a sh:NodeShape ;
    sh:targetClass tori:Stage ;
    rdfs:label "Stage Shape" ;
    rdfs:comment "Validates structural constraints on tori:Stage instances." ;

    # P1 — stageId: exactly 1 UUID v4
    sh:property [
        sh:path tori:stageId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Stage must have exactly one stageId conforming to UUID v4 format." ;
    ] ;

    # P2 — stageName: exactly 1 non-empty string
    sh:property [
        sh:path tori:stageName ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 1 ;
        sh:severity sh:Violation ;
        sh:message "Stage must have exactly one non-empty stageName." ;
    ] ;

    # P3 — belongsToWorkflow: exactly 1 Workflow (stages cannot be shared across workflows)
    sh:property [
        sh:path tori:belongsToWorkflow ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:class tori:Workflow ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Stage '{$this}' must belong to exactly one tori:Workflow (C6 prerequisite)." ;
    ] .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | stageId | `tori:stageId` | exactly 1, UUID v4 | Violation | Unique identifier |
| P2 | stageName | `tori:stageName` | exactly 1, non-empty | Violation | Human-readable name |
| P3 | belongsToWorkflow | `tori:belongsToWorkflow` | exactly 1, class=Workflow | Violation | C6 prerequisite |

#### Validation Examples

**Valid instance:**
```turtle
tori:stage-execute
    a tori:Stage ;
    tori:stageId "cc0e8400-e29b-41d4-a716-446655440000" ;
    tori:stageName "Execute" ;
    tori:belongsToWorkflow tori:workflow-ontology-upgrade .
```
*Result: `sh:conforms true`*

**Invalid instance (no workflow membership):**
```turtle
tori:stage-orphan
    a tori:Stage ;
    tori:stageId "cc0e8400-e29b-41d4-a716-446655440001" ;
    tori:stageName "OrphanStage" .
    # Missing tori:belongsToWorkflow
```
*Expected violation:* `sh:resultMessage "Stage 'tori:stage-orphan' must belong to exactly one tori:Workflow (C6 prerequisite)."` at path `tori:belongsToWorkflow`, severity `sh:Violation`.

---

### 3.9 `tori:TransitionShape`

**Target class:** `tori:Transition`
**Axioms enforced:** C6 — fromStage and toStage must belong to the same Workflow (SPARQL constraint)

#### Turtle Definition

```turtle
tori:TransitionShape
    a sh:NodeShape ;
    sh:targetClass tori:Transition ;
    rdfs:label "Transition Shape" ;
    rdfs:comment "Validates structural constraints on tori:Transition instances. Enforces C6 via SPARQL." ;

    # P1 — transitionId: exactly 1 UUID v4
    sh:property [
        sh:path tori:transitionId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Transition must have exactly one transitionId conforming to UUID v4 format." ;
    ] ;

    # P2 — fromStage: exactly 1 Stage
    sh:property [
        sh:path tori:fromStage ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:class tori:Stage ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Transition '{$this}' must have exactly one tori:fromStage." ;
    ] ;

    # P3 — toStage: exactly 1 Stage
    sh:property [
        sh:path tori:toStage ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:class tori:Stage ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Transition '{$this}' must have exactly one tori:toStage." ;
    ] ;

    # P4 — guardCondition: optional string (SPARQL/Datalog expression)
    sh:property [
        sh:path tori:guardCondition ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:severity sh:Violation ;
        sh:message "Transition '{$this}' guardCondition must be a single xsd:string if present." ;
    ] ;

    # C6 SPARQL constraint: fromStage and toStage must belong to the same Workflow
    sh:sparql [
        a sh:SPARQLConstraint ;
        sh:severity sh:Violation ;
        sh:message "C6 Violation: Transition '{$this}' connects stages from different workflows. fromStage workflow: '{$fromWorkflow}', toStage workflow: '{$toWorkflow}'." ;
        sh:select """
            PREFIX tori: <https://tori-agent.dev/ontology/2026/core#>
            SELECT $this ?fromWorkflow ?toWorkflow
            WHERE {
                $this tori:fromStage ?from .
                $this tori:toStage   ?to .
                ?from tori:belongsToWorkflow ?fromWorkflow .
                ?to   tori:belongsToWorkflow ?toWorkflow .
                FILTER ( ?fromWorkflow != ?toWorkflow )
            }
        """ ;
    ] .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | transitionId | `tori:transitionId` | exactly 1, UUID v4 | Violation | Unique identifier |
| P2 | fromStage | `tori:fromStage` | exactly 1, class=Stage | Violation | Source stage |
| P3 | toStage | `tori:toStage` | exactly 1, class=Stage | Violation | Target stage |
| P4 | guardCondition | `tori:guardCondition` | max 1, string | Violation | Optional guard expression |
| C6 | SPARQL | cross-entity | fromStage.workflow = toStage.workflow | Violation | **C6 enforcement** |

#### Validation Examples

**Valid instance:**
```turtle
tori:transition-plan-to-execute
    a tori:Transition ;
    tori:transitionId "dd0e8400-e29b-41d4-a716-446655440000" ;
    tori:fromStage tori:stage-plan ;
    tori:toStage tori:stage-execute ;
    tori:guardCondition "planApproved = true" .
# Both stages belong to tori:workflow-ontology-upgrade
```
*Result: `sh:conforms true`*

**Invalid instance (cross-workflow transition — C6 violation):**
```turtle
tori:transition-cross-workflow
    a tori:Transition ;
    tori:transitionId "dd0e8400-e29b-41d4-a716-446655440001" ;
    tori:fromStage tori:stage-plan .        # belongs to workflow-A
    tori:toStage   tori:stage-deploy .      # belongs to workflow-B
```
*Expected violation:* `sh:resultMessage "C6 Violation: Transition 'tori:transition-cross-workflow' connects stages from different workflows."` severity `sh:Violation`.

---

### 3.10 `tori:ArtifactShape`

**Target class:** `tori:Artifact`
**Axioms enforced:** C3 — producedBy exactly 1 Agent; C7 — producedBy ≠ reviewedBy (SPARQL)

#### Turtle Definition

```turtle
tori:ArtifactShape
    a sh:NodeShape ;
    sh:targetClass tori:Artifact ;
    rdfs:label "Artifact Shape" ;
    rdfs:comment "Validates structural constraints on tori:Artifact instances. Enforces C3 and C7." ;

    # P1 — artifactId: exactly 1 UUID v4
    sh:property [
        sh:path tori:artifactId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Artifact must have exactly one artifactId conforming to UUID v4 format." ;
    ] ;

    # P2 — artifactName: exactly 1 non-empty string
    sh:property [
        sh:path tori:artifactName ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 1 ;
        sh:severity sh:Violation ;
        sh:message "Artifact must have exactly one non-empty artifactName." ;
    ] ;

    # P3 — producedBy: exactly 1 Agent (C3: Producer Completeness)
    sh:property [
        sh:path tori:producedBy ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:class tori:Agent ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Artifact '{$this}' must have exactly one tori:producedBy Agent (C3: Producer Completeness)." ;
    ] ;

    # P4 — artifactType: exactly 1, from controlled vocabulary
    sh:property [
        sh:path tori:artifactType ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:in ( "specification" "plan" "brief" "code" "report" "data" "document" "test" ) ;
        sh:severity sh:Violation ;
        sh:message "Artifact '{$this}' artifactType must be one of: specification, plan, brief, code, report, data, document, test." ;
    ] ;

    # P5 — reviewedBy: if present, must point to tori:Agent
    sh:property [
        sh:path tori:reviewedBy ;
        sh:class tori:Agent ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Artifact '{$this}' reviewedBy must reference a tori:Agent instance." ;
    ] ;

    # C7 SPARQL constraint: producedBy agent cannot be in reviewedBy set
    sh:sparql [
        a sh:SPARQLConstraint ;
        sh:severity sh:Violation ;
        sh:message "C7 Violation: Artifact '{$this}' was produced and reviewed by the same Agent '{$producer}'. Review Independence requires different agents." ;
        sh:select """
            PREFIX tori: <https://tori-agent.dev/ontology/2026/core#>
            SELECT $this ?producer
            WHERE {
                $this tori:producedBy  ?producer .
                $this tori:reviewedBy  ?reviewer .
                FILTER ( ?producer = ?reviewer )
            }
        """ ;
    ] .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | artifactId | `tori:artifactId` | exactly 1, UUID v4 | Violation | Unique identifier |
| P2 | artifactName | `tori:artifactName` | exactly 1, non-empty | Violation | Human-readable name |
| P3 | producedBy | `tori:producedBy` | exactly 1, class=Agent | Violation | **C3 enforcement** |
| P4 | artifactType | `tori:artifactType` | exactly 1, enum | Violation | Controlled vocabulary |
| P5 | reviewedBy | `tori:reviewedBy` | class=Agent (if present) | Violation | Optional reviewer references |
| C7 | SPARQL | cross-entity | producedBy ≠ reviewedBy | Violation | **C7 enforcement** |

#### Validation Examples

**Valid instance:**
```turtle
tori:artifact-spec-sc-02
    a tori:Artifact ;
    tori:artifactId "ee0e8400-e29b-41d4-a716-446655440000" ;
    tori:artifactName "Spec-SC-02 SHACL Shapes" ;
    tori:producedBy tori:agent-001 ;
    tori:reviewedBy tori:agent-002 ;  # Different agent — valid
    tori:artifactType "specification" .
```
*Result: `sh:conforms true`*

**Invalid instance (self-review — C7 violation):**
```turtle
tori:artifact-self-reviewed
    a tori:Artifact ;
    tori:artifactId "ee0e8400-e29b-41d4-a716-446655440001" ;
    tori:artifactName "Self-Reviewed Artifact" ;
    tori:producedBy tori:agent-001 ;
    tori:reviewedBy tori:agent-001 ;  # Same agent — violates C7
    tori:artifactType "report" .
```
*Expected violation:* `sh:resultMessage "C7 Violation: Artifact 'tori:artifact-self-reviewed' was produced and reviewed by the same Agent 'tori:agent-001'. Review Independence requires different agents."` severity `sh:Violation`.

---

### 3.11 `tori:KnowledgeShape`

**Target class:** `tori:Knowledge`
**Axioms enforced:** None directly; enforces data quality constraints on knowledge assertions

#### Turtle Definition

```turtle
tori:KnowledgeShape
    a sh:NodeShape ;
    sh:targetClass tori:Knowledge ;
    rdfs:label "Knowledge Shape" ;
    rdfs:comment "Validates structural constraints on tori:Knowledge instances." ;

    # P1 — knowledgeId: exactly 1 UUID v4
    sh:property [
        sh:path tori:knowledgeId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Knowledge must have exactly one knowledgeId conforming to UUID v4 format." ;
    ] ;

    # P2 — knowledgeContent: exactly 1 non-empty string
    sh:property [
        sh:path tori:knowledgeContent ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 1 ;
        sh:severity sh:Violation ;
        sh:message "Knowledge must have exactly one non-empty knowledgeContent." ;
    ] ;

    # P3 — confidence: exactly 1, decimal in [0.0, 1.0]
    sh:property [
        sh:path tori:confidence ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:decimal ;
        sh:minInclusive 0.0 ;
        sh:maxInclusive 1.0 ;
        sh:severity sh:Violation ;
        sh:message "Knowledge '{$this}' confidence must be a decimal in [0.0, 1.0]." ;
    ] ;

    # P4 — derivedFrom: warning if absent (knowledge without provenance is suspicious)
    sh:property [
        sh:path tori:derivedFrom ;
        sh:class tori:Artifact ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Warning ;
        sh:message "Knowledge '{$this}' has no derivedFrom Artifact — provenance is untracked." ;
    ] ;

    # P5 — confidence warning: warn if confidence < 0.5 (low-confidence knowledge)
    sh:sparql [
        a sh:SPARQLConstraint ;
        sh:severity sh:Warning ;
        sh:message "Knowledge '{$this}' has low confidence ({$confidence}) — consider verification before use." ;
        sh:select """
            PREFIX tori: <https://tori-agent.dev/ontology/2026/core#>
            SELECT $this ?confidence
            WHERE {
                $this tori:confidence ?confidence .
                FILTER ( ?confidence < 0.5 )
            }
        """ ;
    ] .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | knowledgeId | `tori:knowledgeId` | exactly 1, UUID v4 | Violation | Unique identifier |
| P2 | knowledgeContent | `tori:knowledgeContent` | exactly 1, non-empty | Violation | The knowledge assertion |
| P3 | confidence | `tori:confidence` | exactly 1, decimal [0.0, 1.0] | Violation | Confidence score |
| P4 | derivedFrom | `tori:derivedFrom` | class=Artifact (if present) | Warning | Provenance tracking |
| P5 | low confidence | SPARQL | confidence < 0.5 | Warning | Data quality signal |

#### Validation Examples

**Valid instance:**
```turtle
tori:knowledge-001
    a tori:Knowledge ;
    tori:knowledgeId "ff0e8400-e29b-41d4-a716-446655440000" ;
    tori:knowledgeContent "SHACL shapes must be validated before workflow stage transitions." ;
    tori:confidence "0.95"^^xsd:decimal ;
    tori:derivedFrom tori:artifact-spec-sc-02 .
```
*Result: `sh:conforms true`*

**Invalid instance (confidence out of range):**
```turtle
tori:knowledge-bad
    a tori:Knowledge ;
    tori:knowledgeId "ff0e8400-e29b-41d4-a716-446655440001" ;
    tori:knowledgeContent "Some fact." ;
    tori:confidence "1.5"^^xsd:decimal .  # Out of range
```
*Expected violation:* `sh:resultMessage "Knowledge 'tori:knowledge-bad' confidence must be a decimal in [0.0, 1.0]."` at path `tori:confidence`, severity `sh:Violation`.

---

### 3.12 `tori:PolicyShape`

**Target class:** `tori:Policy`
**Axioms enforced:** C4 (partial — policyType and effect must be explicit; monotonicity enforced at runtime)

#### Turtle Definition

```turtle
tori:PolicyShape
    a sh:NodeShape ;
    sh:targetClass tori:Policy ;
    rdfs:label "Policy Shape" ;
    rdfs:comment "Validates structural constraints on tori:Policy instances. Enforces C4 (partial)." ;

    # P1 — policyId: exactly 1 UUID v4
    sh:property [
        sh:path tori:policyId ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:pattern "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" ;
        sh:severity sh:Violation ;
        sh:message "Policy must have exactly one policyId conforming to UUID v4 format." ;
    ] ;

    # P2 — policyName: exactly 1 non-empty string
    sh:property [
        sh:path tori:policyName ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:datatype xsd:string ;
        sh:minLength 1 ;
        sh:severity sh:Violation ;
        sh:message "Policy must have exactly one non-empty policyName." ;
    ] ;

    # P3 — policyType: exactly 1, from controlled vocabulary
    sh:property [
        sh:path tori:policyType ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:in ( "permission" "constraint" "validation" "rate-limit" "audit" ) ;
        sh:severity sh:Violation ;
        sh:message "Policy '{$this}' policyType must be one of: permission, constraint, validation, rate-limit, audit." ;
    ] ;

    # P4 — effect: exactly 1, Allow or Deny
    sh:property [
        sh:path tori:effect ;
        sh:minCount 1 ;
        sh:maxCount 1 ;
        sh:in ( "Allow" "Deny" ) ;
        sh:severity sh:Violation ;
        sh:message "Policy '{$this}' effect must be exactly 'Allow' or 'Deny'." ;
    ] ;

    # P5 — appliesTo: at least 1 IRI (the class or instance this policy governs)
    sh:property [
        sh:path tori:appliesTo ;
        sh:minCount 1 ;
        sh:nodeKind sh:IRI ;
        sh:severity sh:Violation ;
        sh:message "Policy '{$this}' must apply to at least one class or instance (tori:appliesTo)." ;
    ] .
```

#### Property Constraints Table

| # | Property | sh:path | Constraint | Severity | Notes |
|---|----------|---------|-----------|---------|-------|
| P1 | policyId | `tori:policyId` | exactly 1, UUID v4 | Violation | Unique identifier |
| P2 | policyName | `tori:policyName` | exactly 1, non-empty | Violation | Human-readable name |
| P3 | policyType | `tori:policyType` | exactly 1, enum | Violation | Controlled vocabulary |
| P4 | effect | `tori:effect` | exactly 1, Allow/Deny | Violation | **C4 partial enforcement** |
| P5 | appliesTo | `tori:appliesTo` | min 1, IRI | Violation | Must govern something |

#### Validation Examples

**Valid instance:**
```turtle
tori:policy-allow-file-read
    a tori:Policy ;
    tori:policyId "110e8400-e29b-41d4-a716-446655440000" ;
    tori:policyName "Allow File Read for Executor Role" ;
    tori:policyType "permission" ;
    tori:effect "Allow" ;
    tori:appliesTo tori:role-executor .
```
*Result: `sh:conforms true`*

**Invalid instance (missing effect):**
```turtle
tori:policy-bad
    a tori:Policy ;
    tori:policyId "110e8400-e29b-41d4-a716-446655440001" ;
    tori:policyName "Incomplete Policy" ;
    tori:policyType "constraint" ;
    tori:appliesTo tori:Agent .
    # Missing tori:effect
```
*Expected violation:* `sh:resultMessage "Policy 'tori:policy-bad' effect must be exactly 'Allow' or 'Deny'."` at path `tori:effect`, severity `sh:Violation`.

---

## 4. Cross-Entity SPARQL Constraints

This section provides the complete, standalone SPARQL constraint blocks for the three axioms that require cross-entity reasoning. These constraints are embedded within their respective shapes (Sections 3.9, 3.10) but are reproduced here in full for clarity and reference.

### 4.1 C6 — Transition Validity

**Axiom:** A Transition's `fromStage` and `toStage` must belong to the same Workflow.

**Rationale:** Transitions model directed edges in a workflow graph. A transition connecting stages from two different workflows would create an invalid cross-workflow dependency that the execution engine cannot resolve.

**Embedded in:** `tori:TransitionShape`

```sparql
# C6: Transition Validity SPARQL Constraint
# Returns all Transition instances where fromStage and toStage
# belong to different Workflow instances.

PREFIX tori: <https://tori-agent.dev/ontology/2026/core#>

SELECT $this ?fromStage ?toStage ?fromWorkflow ?toWorkflow
WHERE {
    # Focus node is the Transition being validated
    $this a tori:Transition .

    # Get the source and target stages
    $this tori:fromStage ?fromStage .
    $this tori:toStage   ?toStage .

    # Get the workflow each stage belongs to
    ?fromStage tori:belongsToWorkflow ?fromWorkflow .
    ?toStage   tori:belongsToWorkflow ?toWorkflow .

    # Violation: stages belong to different workflows
    FILTER ( ?fromWorkflow != ?toWorkflow )
}
```

**Violation message template:**
```
C6 Violation: Transition '{$this}' connects stages from different workflows.
  fromStage: '{$fromStage}' → Workflow: '{$fromWorkflow}'
  toStage:   '{$toStage}'   → Workflow: '{$toWorkflow}'
Action: Ensure both stages belong to the same Workflow before creating a Transition.
```

**Edge cases:**
- If either stage lacks a `belongsToWorkflow` triple, the FILTER will not fire (SPARQL open-world). The `tori:StageShape` P3 constraint (Section 3.8) catches this case separately.
- Self-loops (`fromStage = toStage`) are permitted by this constraint; they are valid in state machines.

---

### 4.2 C7 — Review Independence

**Axiom:** The Agent that produces an Artifact cannot be the same Agent that reviews it.

**Rationale:** Review independence is a fundamental quality control principle. An agent reviewing its own output cannot provide an independent assessment. This constraint prevents accidental or deliberate self-review.

**Embedded in:** `tori:ArtifactShape`

```sparql
# C7: Review Independence SPARQL Constraint
# Returns all Artifact instances where the producedBy agent
# appears in the reviewedBy set.

PREFIX tori: <https://tori-agent.dev/ontology/2026/core#>

SELECT $this ?producer ?reviewer
WHERE {
    # Focus node is the Artifact being validated
    $this a tori:Artifact .

    # Get the producer
    $this tori:producedBy ?producer .

    # Get each reviewer
    $this tori:reviewedBy ?reviewer .

    # Violation: producer and reviewer are the same agent
    FILTER ( ?producer = ?reviewer )
}
```

**Violation message template:**
```
C7 Violation: Artifact '{$this}' was produced and reviewed by the same Agent '{$producer}'.
  Review Independence (C7) requires that the producing agent and reviewing agent are distinct.
Action: Assign a different Agent to review this Artifact, or remove the self-review triple.
```

**Edge cases:**
- If `tori:reviewedBy` is absent, the query returns no rows (no violation). An artifact without a reviewer is valid — review is optional.
- If multiple reviewers are present and only one is the producer, the constraint fires once per violating reviewer triple.
- HybridAgent subclasses are treated as distinct IRIs; two different HybridAgent instances are not considered the same agent even if they share a human operator.

---

### 4.3 C2 — Artifact Dependency Existence

**Axiom:** If Artifact A `dependsOn` Artifact B, then Artifact B must exist in the graph and have a valid `artifactType`.

**Rationale:** Dangling dependency references indicate incomplete or corrupted knowledge graphs. An artifact that depends on a non-existent artifact cannot be validated or reproduced.

**Standalone constraint (applied as a graph-level check, not embedded in a single shape):**

```sparql
# C2: Artifact Dependency Existence SPARQL Constraint
# Returns all Artifact instances that reference a dependsOn target
# that either does not exist or lacks a valid artifactType.

PREFIX tori: <https://tori-agent.dev/ontology/2026/core#>

SELECT ?artifact ?dependency
WHERE {
    # Find artifacts with dependencies
    ?artifact a tori:Artifact .
    ?artifact tori:dependsOn ?dependency .

    # Violation case 1: dependency does not exist as a tori:Artifact
    FILTER NOT EXISTS {
        ?dependency a tori:Artifact .
    }
}

UNION

SELECT ?artifact ?dependency
WHERE {
    ?artifact a tori:Artifact .
    ?artifact tori:dependsOn ?dependency .

    # Violation case 2: dependency exists but has no artifactType (incomplete)
    ?dependency a tori:Artifact .
    FILTER NOT EXISTS {
        ?dependency tori:artifactType ?type .
    }
}
```

**Violation message template:**
```
C2 Violation: Artifact '{?artifact}' dependsOn '{?dependency}' which does not exist
  or is incomplete in the knowledge graph.
Action: Ensure the dependency artifact is registered with a valid artifactType before
  creating the dependsOn relationship.
```

**Note:** C2 is implemented as a graph-level SPARQL query executed by the harness rather than embedded in `tori:ArtifactShape`. This is because SHACL's `sh:sparql` constraint on a NodeShape can only reference the focus node (`$this`) and its immediate neighbors; checking the existence and completeness of a referenced node requires a broader graph query.

---

## 5. Validation Severity Matrix

The following table maps every constraint defined in this spec to its shape, axiom, severity, blocking status, and error message template. This matrix is the authoritative reference for harness implementors.

| Shape | Constraint | Axiom | Severity | Blocking | Error Message Template |
|-------|-----------|-------|---------|---------|----------------------|
| AgentShape | agentId UUID v4 | — | Violation | Yes | "Agent must have exactly one agentId conforming to UUID v4 format." |
| AgentShape | agentName non-empty | — | Violation | Yes | "Agent must have exactly one non-empty agentName." |
| AgentShape | hasRole min 1 | — | Violation | Yes | "Agent '{$this}' must have at least one tori:hasRole pointing to a tori:Role." |
| AgentShape | hasTool class check | — | Violation | Yes | "Agent '{$this}' hasTool must reference a tori:Tool instance." |
| AgentShape | effectivelyHasCapability | C1 | Warning | No | "Agent '{$this}' has no effectivelyHasCapability — check Role→Capability chain." |
| AgentShape | hasKnowledge class check | — | Violation | Yes | "Agent '{$this}' hasKnowledge must reference a tori:Knowledge instance." |
| RoleShape | roleId UUID v4 | — | Violation | Yes | "Role must have exactly one roleId conforming to UUID v4 format." |
| RoleShape | roleName non-empty | — | Violation | Yes | "Role must have exactly one non-empty roleName." |
| RoleShape | requiresCapability min 1 | C1 | Violation | Yes | "Role '{$this}' must require at least one tori:Capability (needed for C1 transitivity)." |
| RoleShape | roleDescription type | — | Violation | Yes | "Role '{$this}' roleDescription must be a single xsd:string if present." |
| CapabilityShape | capabilityId UUID v4 | — | Violation | Yes | "Capability must have exactly one capabilityId conforming to UUID v4 format." |
| CapabilityShape | capabilityName non-empty | — | Violation | Yes | "Capability must have exactly one non-empty capabilityName." |
| CapabilityShape | capabilityDescription min 10 | — | Violation | Yes | "Capability '{$this}' must have a capabilityDescription of at least 10 characters." |
| CapabilityShape | capabilityType enum | — | Violation | Yes | "Capability '{$this}' capabilityType must be one of: tool, reasoning, domain, composite." |
| SkillShape | skillId UUID v4 | — | Violation | Yes | "Skill must have exactly one skillId conforming to UUID v4 format." |
| SkillShape | skillName non-empty | — | Violation | Yes | "Skill must have exactly one non-empty skillName." |
| SkillShape | parameterSchema present | — | Violation | Yes | "Skill '{$this}' must have exactly one parameterSchema (JSON Schema string)." |
| SkillShape | invokesCapability min 1 | — | Violation | Yes | "Skill '{$this}' must invoke at least one tori:Capability." |
| SkillShape | skillVersion semver | — | Violation | Yes | "Skill '{$this}' skillVersion must be a valid semver string (e.g., '1.0.0')." |
| ToolShape | toolId UUID v4 | — | Violation | Yes | "Tool must have exactly one toolId conforming to UUID v4 format." |
| ToolShape | toolName non-empty | — | Violation | Yes | "Tool must have exactly one non-empty toolName." |
| ToolShape | bindsCapability min 1 | C5 | Violation | Yes | "Tool '{$this}' must bind at least one tori:Capability (C5: Tool-Capability Binding)." |
| ToolShape | toolType enum | — | Violation | Yes | "Tool '{$this}' toolType must be one of: mcp, filesystem, network, builtin, external." |
| ToolShape | endpoint OR commandPath | — | Violation | Yes | "Tool '{$this}' must have either a toolEndpoint (URI) or a commandPath (string)." |
| TaskShape | taskId UUID v4 | — | Violation | Yes | "Task must have exactly one taskId conforming to UUID v4 format." |
| TaskShape | taskName non-empty | — | Violation | Yes | "Task must have exactly one non-empty taskName." |
| TaskShape | assignedTo exactly 1 | C3 | Violation | Yes | "Task '{$this}' must be assigned to exactly one tori:Agent (C3: Producer Completeness)." |
| TaskShape | taskStatus enum | — | Violation | Yes | "Task '{$this}' taskStatus must be one of: pending, in-progress, blocked, completed, cancelled, failed." |
| TaskShape | governedBy class check | — | Violation | Yes | "Task '{$this}' governedBy must reference a tori:Policy instance." |
| TaskShape | producedArtifact class check | — | Violation | Yes | "Task '{$this}' producedArtifact must reference a tori:Artifact instance." |
| WorkflowShape | workflowId UUID v4 | — | Violation | Yes | "Workflow must have exactly one workflowId conforming to UUID v4 format." |
| WorkflowShape | workflowName non-empty | — | Violation | Yes | "Workflow must have exactly one non-empty workflowName." |
| WorkflowShape | hasStage min 2 | C6 | Violation | Yes | "Workflow '{$this}' must have at least 2 tori:Stage instances (C6 prerequisite)." |
| WorkflowShape | hasTransition class check | — | Violation | Yes | "Workflow '{$this}' hasTransition must reference a tori:Transition instance." |
| StageShape | stageId UUID v4 | — | Violation | Yes | "Stage must have exactly one stageId conforming to UUID v4 format." |
| StageShape | stageName non-empty | — | Violation | Yes | "Stage must have exactly one non-empty stageName." |
| StageShape | belongsToWorkflow exactly 1 | C6 | Violation | Yes | "Stage '{$this}' must belong to exactly one tori:Workflow (C6 prerequisite)." |
| TransitionShape | transitionId UUID v4 | — | Violation | Yes | "Transition must have exactly one transitionId conforming to UUID v4 format." |
| TransitionShape | fromStage exactly 1 | C6 | Violation | Yes | "Transition '{$this}' must have exactly one tori:fromStage." |
| TransitionShape | toStage exactly 1 | C6 | Violation | Yes | "Transition '{$this}' must have exactly one tori:toStage." |
| TransitionShape | guardCondition type | — | Violation | Yes | "Transition '{$this}' guardCondition must be a single xsd:string if present." |
| TransitionShape | C6 SPARQL | C6 | Violation | Yes | "C6 Violation: Transition '{$this}' connects stages from different workflows." |
| ArtifactShape | artifactId UUID v4 | — | Violation | Yes | "Artifact must have exactly one artifactId conforming to UUID v4 format." |
| ArtifactShape | artifactName non-empty | — | Violation | Yes | "Artifact must have exactly one non-empty artifactName." |
| ArtifactShape | producedBy exactly 1 | C3 | Violation | Yes | "Artifact '{$this}' must have exactly one tori:producedBy Agent (C3: Producer Completeness)." |
| ArtifactShape | artifactType enum | — | Violation | Yes | "Artifact '{$this}' artifactType must be one of: specification, plan, brief, code, report, data, document, test." |
| ArtifactShape | reviewedBy class check | — | Violation | Yes | "Artifact '{$this}' reviewedBy must reference a tori:Agent instance." |
| ArtifactShape | C7 SPARQL | C7 | Violation | Yes | "C7 Violation: Artifact '{$this}' was produced and reviewed by the same Agent '{$producer}'." |
| KnowledgeShape | knowledgeId UUID v4 | — | Violation | Yes | "Knowledge must have exactly one knowledgeId conforming to UUID v4 format." |
| KnowledgeShape | knowledgeContent non-empty | — | Violation | Yes | "Knowledge must have exactly one non-empty knowledgeContent." |
| KnowledgeShape | confidence [0.0, 1.0] | — | Violation | Yes | "Knowledge '{$this}' confidence must be a decimal in [0.0, 1.0]." |
| KnowledgeShape | derivedFrom provenance | — | Warning | No | "Knowledge '{$this}' has no derivedFrom Artifact — provenance is untracked." |
| KnowledgeShape | low confidence SPARQL | — | Warning | No | "Knowledge '{$this}' has low confidence ({$confidence}) — consider verification before use." |
| PolicyShape | policyId UUID v4 | — | Violation | Yes | "Policy must have exactly one policyId conforming to UUID v4 format." |
| PolicyShape | policyName non-empty | — | Violation | Yes | "Policy must have exactly one non-empty policyName." |
| PolicyShape | policyType enum | — | Violation | Yes | "Policy '{$this}' policyType must be one of: permission, constraint, validation, rate-limit, audit." |
| PolicyShape | effect Allow/Deny | C4 | Violation | Yes | "Policy '{$this}' effect must be exactly 'Allow' or 'Deny'." |
| PolicyShape | appliesTo min 1 | — | Violation | Yes | "Policy '{$this}' must apply to at least one class or instance (tori:appliesTo)." |
| Graph-level | C2 SPARQL | C2 | Violation | Yes | "C2 Violation: Artifact '{?artifact}' dependsOn '{?dependency}' which does not exist or is incomplete." |

**Summary counts:**
- Total constraints: 57
- `sh:Violation` (blocking): 53
- `sh:Warning` (non-blocking): 4
- SPARQL constraints: 4 (C2, C6, C7, low-confidence)

---

## 6. Integration with the Harness

### 6.1 Library Recommendation

The TypeScript harness uses **`rdf-validate-shacl`** (npm package `rdf-validate-shacl`, version `^0.5.0`) for SHACL validation. This library:

- Implements the full SHACL Core specification (W3C Recommendation)
- Supports SPARQL-based constraints via `sparql-engine` integration
- Accepts RDF/JS `DataFactory`-compatible datasets (compatible with `n3` and `rdf-data-factory`)
- Returns a W3C-compliant `ValidationReport` object

**Dependencies:**

```json
{
  "dependencies": {
    "rdf-validate-shacl": "^0.5.0",
    "n3": "^1.17.0",
    "jsonld": "^8.3.0",
    "@rdfjs/data-model": "^2.0.1"
  }
}
```

### 6.2 Validation Pipeline

The harness validation pipeline consists of four steps:

1. **Deserialize** — Parse the JSON-LD document into an RDF dataset using `jsonld` + `n3`
2. **Load shapes** — Parse `tori-shapes.ttl` into a separate RDF dataset
3. **Validate** — Run `rdf-validate-shacl` against the data dataset using the shapes dataset
4. **Map results** — Convert the `ValidationReport` into structured TypeScript errors

### 6.3 TypeScript Integration Sketch

```typescript
// packages/core/src/ontology/shacl-validator.ts

import { Parser as N3Parser, Store as N3Store, DataFactory } from "n3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import SHACLValidator from "rdf-validate-shacl";
import * as jsonld from "jsonld";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ShaclViolation {
  focusNode: string;
  resultPath: string | null;
  message: string;
  severity: "Violation" | "Warning" | "Info";
  sourceShape: string | null;
  sourceConstraintComponent: string | null;
}

export interface ShaclValidationResult {
  conforms: boolean;
  violations: ShaclViolation[];
  warnings: ShaclViolation[];
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly violations: ShaclViolation[]
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

// ── Constants ──────────────────────────────────────────────────────────────

const SHAPES_PATH = resolve(
  import.meta.dirname,
  "../../ontology/shapes/tori-shapes.ttl"
);

const SH_VIOLATION = "http://www.w3.org/ns/shacl#Violation";
const SH_WARNING   = "http://www.w3.org/ns/shacl#Warning";

// ── Shapes graph (loaded once at module init) ──────────────────────────────

function loadShapesGraph(): N3Store {
  const shapesText = readFileSync(SHAPES_PATH, "utf-8");
  const parser = new N3Parser({ format: "Turtle" });
  const store = new N3Store();
  store.addQuads(parser.parse(shapesText));
  return store;
}

const shapesGraph: N3Store = loadShapesGraph();

// ── Core validation function ───────────────────────────────────────────────

/**
 * Validate a JSON-LD document against the tori SHACL shapes.
 *
 * @param jsonLdDocument - The JSON-LD object to validate
 * @param throwOnViolation - If true (default), throws ValidationError on sh:Violation
 * @returns ShaclValidationResult with violations and warnings
 */
export async function validateJsonLd(
  jsonLdDocument: Record<string, unknown>,
  throwOnViolation = true
): Promise<ShaclValidationResult> {
  // Step 1: Convert JSON-LD to N-Quads
  const nquads = await jsonld.toRDF(jsonLdDocument, { format: "application/n-quads" }) as string;

  // Step 2: Parse N-Quads into an N3 Store (data graph)
  const dataStore = new N3Store();
  const parser = new N3Parser({ format: "N-Quads" });
  dataStore.addQuads(parser.parse(nquads));

  // Step 3: Run SHACL validation
  const validator = new SHACLValidator(shapesGraph, { factory: DataFactory });
  const report = await validator.validate(dataStore);

  // Step 4: Map ValidationReport to structured TypeScript types
  const violations: ShaclViolation[] = [];
  const warnings: ShaclViolation[] = [];

  for (const result of report.results) {
    const entry: ShaclViolation = {
      focusNode: result.focusNode?.value ?? "(unknown)",
      resultPath: result.resultPath?.value ?? null,
      message: result.message.map((m) => m.value).join("; "),
      severity: result.severity?.value === SH_VIOLATION ? "Violation"
               : result.severity?.value === SH_WARNING  ? "Warning"
               : "Info",
      sourceShape: result.sourceShape?.value ?? null,
      sourceConstraintComponent: result.sourceConstraintComponent?.value ?? null,
    };

    if (entry.severity === "Violation") {
      violations.push(entry);
    } else {
      warnings.push(entry);
    }
  }

  const validationResult: ShaclValidationResult = {
    conforms: report.conforms && violations.length === 0,
    violations,
    warnings,
  };

  // Step 5: Throw on violations if requested
  if (throwOnViolation && violations.length > 0) {
    const summary = violations.map((v) => `  [${v.focusNode}] ${v.message}`).join("\n");
    throw new ValidationError(
      `SHACL validation failed with ${violations.length} violation(s):\n${summary}`,
      violations
    );
  }

  return validationResult;
}

// ── Convenience: validate on mutation ─────────────────────────────────────

/**
 * Validate a single ontological instance before committing a mutation.
 * Throws ValidationError if any sh:Violation is found.
 */
export async function validateOnMutation(
  instance: Record<string, unknown>
): Promise<void> {
  await validateJsonLd(instance, true);
}

// ── Convenience: validate full graph on verify stage entry ─────────────────

/**
 * Validate the entire knowledge graph at verify stage entry.
 * Returns the full result including warnings (non-blocking).
 */
export async function validateFullGraph(
  graphDocuments: Record<string, unknown>[]
): Promise<ShaclValidationResult> {
  // Merge all documents into a single JSON-LD @graph
  const merged = {
    "@context": "https://tori-agent.dev/ontology/2026/context.jsonld",
    "@graph": graphDocuments,
  };
  return validateJsonLd(merged, true);
}
```

### 6.4 Error Handling Strategy

The harness maps SHACL results to TypeScript errors as follows:

| SHACL Severity | Harness Behavior | Log Level | Blocks Execution? |
|---------------|-----------------|-----------|------------------|
| `sh:Violation` | Throws `ValidationError` | `error` | **Yes** |
| `sh:Warning` | Returns in `warnings[]` | `warn` | No |
| `sh:Info` | Returns in `warnings[]` | `debug` | No |

The `ValidationError` class extends `Error` and carries the full `violations[]` array, enabling callers to inspect individual violations programmatically (e.g., for structured error reporting in CI pipelines).

---

## 7. Shapes File Layout

The `packages/ontology/` package contains all ontological artifacts. The shapes are organized as follows:

```
packages/ontology/
├── package.json
├── tsconfig.json
├── shapes/
│   ├── tori-shapes.ttl          # Master shapes file — imports all 12 individual shapes
│   ├── agent-shape.ttl          # tori:AgentShape (Section 3.1)
│   ├── role-shape.ttl           # tori:RoleShape (Section 3.2)
│   ├── capability-shape.ttl     # tori:CapabilityShape (Section 3.3)
│   ├── skill-shape.ttl          # tori:SkillShape (Section 3.4)
│   ├── tool-shape.ttl           # tori:ToolShape (Section 3.5)
│   ├── task-shape.ttl           # tori:TaskShape (Section 3.6)
│   ├── workflow-shape.ttl       # tori:WorkflowShape (Section 3.7)
│   ├── stage-shape.ttl          # tori:StageShape (Section 3.8)
│   ├── transition-shape.ttl     # tori:TransitionShape (Section 3.9)
│   ├── artifact-shape.ttl       # tori:ArtifactShape (Section 3.10)
│   ├── knowledge-shape.ttl      # tori:KnowledgeShape (Section 3.11)
│   └── policy-shape.ttl         # tori:PolicyShape (Section 3.12)
├── ontology/
│   └── tori-ontology.ttl        # OWL ontology (from SC-01)
├── context/
│   └── tori-context.jsonld      # JSON-LD @context (from SC-04)
└── fixtures/
    ├── valid/
    │   ├── agent-valid.jsonld
    │   ├── artifact-valid.jsonld
    │   └── workflow-valid.jsonld
    └── invalid/
        ├── agent-no-role.jsonld
        ├── artifact-self-review.jsonld
        └── transition-cross-workflow.jsonld
```

### 7.1 Master Shapes File (`tori-shapes.ttl`)

The master file imports all individual shape files using `owl:imports`:

```turtle
@prefix tori:  <https://tori-agent.dev/ontology/2026/core#> .
@prefix sh:    <http://www.w3.org/ns/shacl#> .
@prefix owl:   <http://www.w3.org/2002/07/owl#> .
@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .

# Tori Agent SHACL Shapes — Master File
# Version: 0.1.0
# Spec: SC-02
# Imports all 12 individual shape files.

<https://tori-agent.dev/ontology/2026/shapes>
    a owl:Ontology ;
    rdfs:label "Tori Agent SHACL Shapes" ;
    rdfs:comment "Master SHACL shapes graph for the tori-agent ontological upgrade." ;
    owl:versionInfo "0.1.0" ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/agent> ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/role> ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/capability> ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/skill> ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/tool> ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/task> ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/workflow> ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/stage> ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/transition> ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/artifact> ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/knowledge> ;
    owl:imports <https://tori-agent.dev/ontology/2026/shapes/policy> .
```

**Note:** In practice, `rdf-validate-shacl` does not resolve `owl:imports` automatically. The harness loads all individual `.ttl` files and merges them into a single `N3Store` before passing to the validator. The `owl:imports` declarations serve as documentation of the intended modular structure.

### 7.2 Individual Shape File Convention

Each individual shape file follows this template:

```turtle
# {ClassName} Shape — tori-agent SHACL Shapes
# Spec: SC-02, Section 3.{N}
# Axioms enforced: {list}

@prefix tori:  <https://tori-agent.dev/ontology/2026/core#> .
@prefix sh:    <http://www.w3.org/ns/shacl#> .
@prefix owl:   <http://www.w3.org/2002/07/owl#> .
@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .

<https://tori-agent.dev/ontology/2026/shapes/{name}>
    a owl:Ontology ;
    rdfs:label "{ClassName} Shape Graph" .

tori:{ClassName}Shape
    a sh:NodeShape ;
    # ... shape definition ...
    .
```

---

## 8. Conformance Checklist

The following checklist defines the conformance requirements for an implementation of SC-02. Items marked **[NORMATIVE]** are mandatory; items marked **[RECOMMENDED]** are strongly advised but not strictly required.

### 8.1 Shape Completeness

- [ ] **[NORMATIVE]** All 12 shapes (`AgentShape`, `RoleShape`, `CapabilityShape`, `SkillShape`, `ToolShape`, `TaskShape`, `WorkflowShape`, `StageShape`, `TransitionShape`, `ArtifactShape`, `KnowledgeShape`, `PolicyShape`) are defined in the shapes graph.
- [ ] **[NORMATIVE]** Each shape targets the correct OWL class via `sh:targetClass`.
- [ ] **[NORMATIVE]** All shapes are parseable as valid Turtle 1.1 syntax (verified by `rapper -i turtle` or equivalent).
- [ ] **[NORMATIVE]** The master shapes file `tori-shapes.ttl` loads without parse errors.

### 8.2 Constraint Coverage

- [ ] **[NORMATIVE]** All `sh:Violation` constraints listed in Section 5 are present in the shapes graph.
- [ ] **[NORMATIVE]** All `sh:Warning` constraints listed in Section 5 are present in the shapes graph.
- [ ] **[NORMATIVE]** The C6 SPARQL constraint (Section 4.1) is embedded in `tori:TransitionShape`.
- [ ] **[NORMATIVE]** The C7 SPARQL constraint (Section 4.2) is embedded in `tori:ArtifactShape`.
- [ ] **[NORMATIVE]** The C2 graph-level SPARQL query (Section 4.3) is implemented in the harness.
- [ ] **[RECOMMENDED]** The low-confidence SPARQL warning (Section 3.11 P5) is present in `tori:KnowledgeShape`.

### 8.3 Harness Behavior

- [ ] **[NORMATIVE]** The harness throws `ValidationError` on any `sh:Violation` result.
- [ ] **[NORMATIVE]** The harness logs `sh:Warning` results at `warn` level without blocking execution.
- [ ] **[NORMATIVE]** SHACL validation is triggered on every ontological instance mutation.
- [ ] **[NORMATIVE]** SHACL validation is triggered at the start of every `verify` workflow stage.
- [ ] **[RECOMMENDED]** The harness caches the parsed shapes graph across validation calls (not re-parsed per call).
- [ ] **[RECOMMENDED]** The `ValidationError` message includes the focus node IRI and the violation message for each violation.

### 8.4 Testing

- [ ] **[NORMATIVE]** At least one valid fixture exists for each of the 12 shapes and passes validation.
- [ ] **[NORMATIVE]** At least one invalid fixture exists for each `sh:Violation` constraint and produces the expected violation.
- [ ] **[NORMATIVE]** The C6 SPARQL constraint is tested with a cross-workflow transition fixture.
- [ ] **[NORMATIVE]** The C7 SPARQL constraint is tested with a self-review artifact fixture.
- [ ] **[RECOMMENDED]** The C2 graph-level query is tested with a dangling dependency fixture.
- [ ] **[RECOMMENDED]** Shapes are validated using `pyshacl --validate --shacl tori-shapes.ttl --data fixtures/valid/*.jsonld` or equivalent.

### 8.5 Interoperability

- [ ] **[NORMATIVE]** All property IRIs used in shapes match the property IRIs defined in SC-01.
- [ ] **[NORMATIVE]** All class IRIs used in `sh:targetClass` and `sh:class` match the class IRIs defined in SC-01.
- [ ] **[RECOMMENDED]** Shapes are tested against both `rdf-validate-shacl` (TypeScript harness) and `pyshacl` (Python reference implementation) to ensure cross-implementation consistency.

---

## 9. Related Specs

| Spec | Title | Status | Relationship |
|------|-------|--------|--------------|
| SC-01 | Ontology Schema — Core Classes & Properties | draft | **Normative dependency** — SC-02 shapes enforce the OWL classes and properties defined in SC-01. Any change to SC-01 class or property IRIs requires a corresponding update to SC-02. |
| SC-03 | Datalog Policy Engine | draft | **Normative companion** — SC-03 Datalog rules complement SHACL shapes. SHACL enforces structural constraints (closed-world); Datalog enforces operational rules (capability propagation, permission monotonicity). Together they implement the full Neuro-symbolic Triad. |
| SC-04 | JSON-LD Context & Serialization | draft | **Informative** — SC-04 defines the JSON-LD `@context` that maps compact property names to the full IRIs used in SC-02 shapes. Implementations must use the SC-04 context when serializing instances for validation. |

---

## Appendix A: Complete Prefix Declarations

All Turtle files in `packages/ontology/shapes/` use the following prefix declarations:

```turtle
@prefix tori:  <https://tori-agent.dev/ontology/2026/core#> .
@prefix sh:    <http://www.w3.org/ns/shacl#> .
@prefix owl:   <http://www.w3.org/2002/07/owl#> .
@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
@prefix dash:  <http://datashapes.org/dash#> .
```

The `dash:` prefix is optional but recommended for DASH extensions (e.g., `dash:hasValueWithClass` for inverse property constraints).

---

## Appendix B: UUID v4 Pattern Reference

All `*Id` properties in this spec use the UUID v4 format, enforced by the SHACL pattern:

```
^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
```

This pattern enforces:
- Lowercase hexadecimal digits only
- Version 4 (the third group starts with `4`)
- Variant 1 (the fourth group starts with `8`, `9`, `a`, or `b`)

Example valid UUID v4: `550e8400-e29b-41d4-a716-446655440000`

---

## Appendix C: Controlled Vocabulary Reference

| Property | Allowed Values |
|----------|---------------|
| `tori:capabilityType` | `tool`, `reasoning`, `domain`, `composite` |
| `tori:toolType` | `mcp`, `filesystem`, `network`, `builtin`, `external` |
| `tori:taskStatus` | `pending`, `in-progress`, `blocked`, `completed`, `cancelled`, `failed` |
| `tori:artifactType` | `specification`, `plan`, `brief`, `code`, `report`, `data`, `document`, `test` |
| `tori:policyType` | `permission`, `constraint`, `validation`, `rate-limit`, `audit` |
| `tori:effect` | `Allow`, `Deny` |

---

*End of [Spec-SC-02] SHACL Shapes for Ontology Validation*
