---
title: "[Spec-SC-04] JSON-LD Context & Serialization"
status: draft
created: 2026-09-06
spec_id: SC-04
domain: ontology/serialization
version: "0.1.0"
authors:
  - Lead Systems Architect
related_specs:
  - SC-01: Ontology Schema (normative dependency)
  - SC-02: SHACL Shapes (normative companion)
  - SC-03: Datalog Policy Engine (normative companion)
---

# [Spec-SC-04] JSON-LD Context & Serialization

---

## 1. Executive Summary

### 1.1 Role of JSON-LD in the Neuro-symbolic Triad

The tori-agent system is built on a **Neuro-symbolic Triad** — three complementary layers that together provide formal semantics, structural validation, and operational policy enforcement:

| Layer | Technology | Role | Spec |
|-------|-----------|------|------|
| **Tier 1 — Semantic Core** | JSON-LD / OWL 2 DL | Defines meaning: class hierarchy, property semantics, inference axioms | SC-01 |
| **Tier 2 — Reasoning Engine** | SHACL (Shapes Constraint Language) | Validates structure: cardinality, type constraints, cross-entity rules | SC-02 |
| **Tier 3 — Policy Engine** | Datalog (Soufflé dialect) | Enforces operational rules: capability propagation, permission monotonicity | SC-03 |
| **Serialization Layer** | JSON-LD 1.1 Context & Serialization | Exchange format between RDF store, harness, and agents | **SC-04 (this spec)** |

SC-04 defines the **normative JSON-LD `@context`** and all serialization rules for exchanging ontology instances between the RDF store, the harness, and the agents. It is the glue that makes the three tiers interoperable: every instance document produced by an agent, consumed by the harness, or stored in the knowledge graph MUST conform to the rules in this specification.

### 1.2 Why JSON-LD Over Plain JSON

Plain JSON is opaque: a field named `"id"` in one system means something different in another. JSON-LD solves this by binding every key to a globally unambiguous IRI, enabling:

1. **Linked data** — nodes reference each other by IRI, forming a graph rather than a tree. An agent's `hasRole` property points to a `Role` node that can be dereferenced independently.
2. **Interoperability** — any JSON-LD processor (Python's `rdflib`, Java's `titanium-json-ld`, JavaScript's `jsonld.js`) can parse a tori-agent document without prior knowledge of the schema.
3. **RDF round-tripping** — a JSON-LD document can be expanded to N-Quads, loaded into any RDF store (Apache Jena, Oxigraph, RDFLib), queried with SPARQL, validated with SHACL, and serialized back to JSON-LD without data loss.
4. **OWL reasoning** — the expanded RDF dataset can be fed to an OWL reasoner (HermiT, ELK) to derive inferred triples that are not present in the source document.
5. **Datalog EDB export** — the N-Quads representation is the canonical source for the CSV fact files consumed by the Soufflé Datalog engine (SC-03).

### 1.3 Three Graph Types and Their Serialization

The tori-agent system maintains three distinct graph types, each with different serialization requirements:

| Graph Type | Content | Primary Format | Location | Update Frequency |
|-----------|---------|---------------|----------|-----------------|
| **Stable Ontology Graph** | Class definitions, property definitions, OWL axioms | Turtle (`.ttl`) | `packages/ontology/ontology/tori-ontology.ttl` | Versioned releases only |
| **Dynamic Knowledge Graph** | Project-specific instances: agents, tasks, artifacts, workflows | JSON-LD (`.jsonld`) | `.opencode/knowledge-graph.jsonld` | On every harness mutation |
| **Ephemeral Execution Graph** | In-flight task state, capability tokens, permission grants | In-memory JSON-LD | Never persisted | Single workflow execution |

### 1.4 JSON-LD Serialization Forms

JSON-LD 1.1 defines four canonical processing forms. Each serves a distinct purpose in the tori-agent pipeline:

| Form | Description | Use Case | Consumer |
|------|-------------|----------|----------|
| **Compacted** | Human-readable; uses `@context` to abbreviate IRIs | Authoring, storage, agent I/O | Agents, harness, humans |
| **Expanded** | All IRIs fully qualified; no `@context` | Intermediate processing, RDF conversion | `jsonld.js`, SHACL validator |
| **Flattened** | All nodes at top level; no nesting | Graph database ingestion, diff computation | RDF stores, Datalog EDB export |
| **Framed** | Subgraph selected by shape template | Query results, agent context injection | Agents receiving task context |

**Rule:** The Dynamic Knowledge Graph is stored in **compacted** form. The SHACL validator and Datalog engine operate on **expanded** (N-Quads) form. Agents receive task context in **framed** form. The Stable Ontology Graph is stored in **Turtle** (not JSON-LD) as the primary format.

---

## 2. JSON-LD Primer

This section provides a concise reference for JSON-LD 1.1 features used in this specification. Readers familiar with JSON-LD 1.1 may skip to Section 3.

### 2.1 Core Keywords

| Keyword | Purpose | Example |
|---------|---------|---------|
| `@context` | Maps JSON keys to IRIs | `"@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld"` |
| `@id` | Node identifier (IRI or blank node) | `"@id": "tori:agent/abc123"` |
| `@type` | RDF type (maps to `rdf:type`) | `"@type": "tori:Agent"` |
| `@value` | Literal value | `"@value": "hello"` |
| `@language` | Language tag for string literals | `"@language": "en"` |
| `@graph` | Named graph or array of nodes | `"@graph": [...]` |
| `@container` | Specifies collection semantics | `"@container": "@set"` |
| `@vocab` | Default vocabulary prefix | `"@vocab": "https://tori-agent.dev/ontology/2026/core#"` |

### 2.2 Compact IRIs vs Full IRIs

A **compact IRI** uses a prefix defined in `@context` to abbreviate a full IRI:

```json
{
  "@context": {
    "tori": "https://tori-agent.dev/ontology/2026/core#"
  },
  "@type": "tori:Agent"
}
```

The compact IRI `tori:Agent` expands to the full IRI `https://tori-agent.dev/ontology/2026/core#Agent`. Processors MUST expand compact IRIs before RDF conversion.

### 2.3 Container Types

| Container | Semantics | When to Use |
|-----------|-----------|-------------|
| `@container: "@set"` | Unordered collection; serialized as JSON array | Multi-valued object properties (e.g., `hasRole`, `hasTool`) |
| `@container: "@list"` | Ordered sequence; serialized as `rdf:List` | Ordered sequences (e.g., stage ordering in a workflow) |
| `@container: "@index"` | Map keyed by index value | Lookup maps (e.g., capability index by type) |
| `@container: "@language"` | Map keyed by language tag | Multi-language labels |

**Rule:** All multi-valued object properties in the tori-agent context use `@container: "@set"`. This means they are serialized as JSON arrays even when only one value is present, and they map to `rdf:type owl:ObjectProperty` with no ordering constraint.

### 2.4 Type Coercion

Type coercion in `@context` eliminates the need for `@type` annotations on every value:

```json
{
  "@context": {
    "tori": "https://tori-agent.dev/ontology/2026/core#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "hasRole": {
      "@id": "tori:hasRole",
      "@type": "@id",
      "@container": "@set"
    },
    "createdAt": {
      "@id": "tori:createdAt",
      "@type": "xsd:dateTime"
    }
  }
}
```

- `"@type": "@id"` coerces the value to an IRI (object property).
- `"@type": "xsd:dateTime"` coerces the value to an `xsd:dateTime` literal.

### 2.5 Framing

JSON-LD Framing selects a subgraph from a flattened document by matching nodes against a frame template. The frame specifies the desired output shape:

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:Agent",
  "hasRole": {
    "@type": "tori:Role",
    "grants": { "@type": "tori:Capability" }
  }
}
```

This frame extracts all `Agent` nodes, embedding their `Role` nodes and each role's `Capability` nodes. Framing is used to inject agent context at task assignment time (Section 8).

---

## 3. Normative `@context` Document

This section defines the canonical JSON-LD context for the tori-agent ontology. The context file MUST be deployed at:

- **Canonical URI:** `https://tori-agent.dev/ontology/2026/core/context.jsonld`
- **Local path:** `packages/ontology/context/tori-context.jsonld`

The local path is the authoritative source during development. The canonical URI resolves to the same content in production deployments.

### 3.1 Complete Context Document

```json
{
  "@context": {
    "@version": 1.1,

    "tori":  "https://tori-agent.dev/ontology/2026/core#",
    "toria": "https://tori-agent.dev/ontology/2026/agent#",
    "owl":   "http://www.w3.org/2002/07/owl#",
    "rdf":   "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs":  "http://www.w3.org/2000/01/rdf-schema#",
    "xsd":   "http://www.w3.org/2001/XMLSchema#",
    "sh":    "http://www.w3.org/ns/shacl#",
    "skos":  "http://www.w3.org/2004/02/skos/core#",

    "Agent":               { "@id": "tori:Agent",               "@type": "@id" },
    "AIAgent":             { "@id": "tori:AIAgent",             "@type": "@id" },
    "HumanAgent":          { "@id": "tori:HumanAgent",          "@type": "@id" },
    "HybridAgent":         { "@id": "tori:HybridAgent",         "@type": "@id" },
    "SpecialistAgent":     { "@id": "tori:SpecialistAgent",     "@type": "@id" },

    "Role":                { "@id": "tori:Role",                "@type": "@id" },

    "Capability":          { "@id": "tori:Capability",          "@type": "@id" },
    "ToolCapability":      { "@id": "tori:ToolCapability",      "@type": "@id" },
    "ReasoningCapability": { "@id": "tori:ReasoningCapability", "@type": "@id" },
    "DomainCapability":    { "@id": "tori:DomainCapability",    "@type": "@id" },
    "DerivedCapability":   { "@id": "tori:DerivedCapability",   "@type": "@id" },

    "Skill":               { "@id": "tori:Skill",               "@type": "@id" },

    "Tool":                { "@id": "tori:Tool",                "@type": "@id" },
    "MCPTool":             { "@id": "tori:MCPTool",             "@type": "@id" },
    "FilesystemTool":      { "@id": "tori:FilesystemTool",      "@type": "@id" },
    "NetworkTool":         { "@id": "tori:NetworkTool",         "@type": "@id" },
    "BuiltinTool":         { "@id": "tori:BuiltinTool",         "@type": "@id" },

    "Task":                { "@id": "tori:Task",                "@type": "@id" },
    "AtomicTask":          { "@id": "tori:AtomicTask",          "@type": "@id" },
    "CompositeTask":       { "@id": "tori:CompositeTask",       "@type": "@id" },

    "Workflow":            { "@id": "tori:Workflow",            "@type": "@id" },
    "Stage":               { "@id": "tori:Stage",               "@type": "@id" },
    "Transition":          { "@id": "tori:Transition",          "@type": "@id" },

    "Artifact":            { "@id": "tori:Artifact",            "@type": "@id" },
    "Specification":       { "@id": "tori:Specification",       "@type": "@id" },
    "Plan":                { "@id": "tori:Plan",                "@type": "@id" },
    "Brief":               { "@id": "tori:Brief",               "@type": "@id" },
    "Code":                { "@id": "tori:Code",                "@type": "@id" },
    "Report":              { "@id": "tori:Report",              "@type": "@id" },
    "FileArtifact":        { "@id": "tori:FileArtifact",        "@type": "@id" },
    "DocumentArtifact":    { "@id": "tori:DocumentArtifact",    "@type": "@id" },
    "DataArtifact":        { "@id": "tori:DataArtifact",        "@type": "@id" },

    "Knowledge":           { "@id": "tori:Knowledge",           "@type": "@id" },
    "SkillKnowledge":      { "@id": "tori:SkillKnowledge",      "@type": "@id" },
    "DomainKnowledge":     { "@id": "tori:DomainKnowledge",     "@type": "@id" },

    "Policy":              { "@id": "tori:Policy",              "@type": "@id" },
    "PermissionPolicy":    { "@id": "tori:PermissionPolicy",    "@type": "@id" },
    "ConstraintPolicy":    { "@id": "tori:ConstraintPolicy",    "@type": "@id" },
    "ValidationPolicy":    { "@id": "tori:ValidationPolicy",    "@type": "@id" },
    "AllowPolicy":         { "@id": "tori:AllowPolicy",         "@type": "@id" },
    "DenyPolicy":          { "@id": "tori:DenyPolicy",          "@type": "@id" },

    "hasRole": {
      "@id": "tori:hasRole",
      "@type": "@id",
      "@container": "@set"
    },
    "assumesRole": {
      "@id": "tori:assumesRole",
      "@type": "@id",
      "@container": "@set"
    },
    "grants": {
      "@id": "tori:grants",
      "@type": "@id",
      "@container": "@set"
    },
    "inheritsFrom": {
      "@id": "tori:inheritsFrom",
      "@type": "@id",
      "@container": "@set"
    },
    "requiresCapability": {
      "@id": "tori:requiresCapability",
      "@type": "@id",
      "@container": "@set"
    },
    "effectivelyHasCapability": {
      "@id": "tori:effectivelyHasCapability",
      "@type": "@id",
      "@container": "@set"
    },
    "canPerform": {
      "@id": "tori:canPerform",
      "@type": "@id",
      "@container": "@set"
    },
    "hasTool": {
      "@id": "tori:hasTool",
      "@type": "@id",
      "@container": "@set"
    },
    "hasSkill": {
      "@id": "tori:hasSkill",
      "@type": "@id",
      "@container": "@set"
    },
    "bindsCapability": {
      "@id": "tori:bindsCapability",
      "@type": "@id",
      "@container": "@set"
    },
    "assignedTo": {
      "@id": "tori:assignedTo",
      "@type": "@id"
    },
    "producedBy": {
      "@id": "tori:producedBy",
      "@type": "@id"
    },
    "reviewedBy": {
      "@id": "tori:reviewedBy",
      "@type": "@id",
      "@container": "@set"
    },
    "dependsOn": {
      "@id": "tori:dependsOn",
      "@type": "@id",
      "@container": "@set"
    },
    "hasStage": {
      "@id": "tori:hasStage",
      "@type": "@id",
      "@container": "@set"
    },
    "hasTransition": {
      "@id": "tori:hasTransition",
      "@type": "@id",
      "@container": "@set"
    },
    "fromStage": {
      "@id": "tori:fromStage",
      "@type": "@id"
    },
    "toStage": {
      "@id": "tori:toStage",
      "@type": "@id"
    },
    "governedBy": {
      "@id": "tori:governedBy",
      "@type": "@id",
      "@container": "@set"
    },
    "hasKnowledge": {
      "@id": "tori:hasKnowledge",
      "@type": "@id",
      "@container": "@set"
    },
    "invokes": {
      "@id": "tori:invokes",
      "@type": "@id",
      "@container": "@set"
    },
    "parameterizedBy": {
      "@id": "tori:parameterizedBy",
      "@type": "@id"
    },
    "belongsToWorkflow": {
      "@id": "tori:belongsToWorkflow",
      "@type": "@id"
    },
    "guardedBy": {
      "@id": "tori:guardedBy",
      "@type": "@id",
      "@container": "@set"
    },
    "derivedFrom": {
      "@id": "tori:derivedFrom",
      "@type": "@id",
      "@container": "@set"
    },
    "appliesTo": {
      "@id": "tori:appliesTo",
      "@type": "@id",
      "@container": "@set"
    },
    "participatesIn": {
      "@id": "tori:participatesIn",
      "@type": "@id",
      "@container": "@set"
    },
    "executedBy": {
      "@id": "tori:executedBy",
      "@type": "@id"
    },
    "canExecute": {
      "@id": "tori:canExecute",
      "@type": "@id",
      "@container": "@set"
    },
    "subsumes": {
      "@id": "tori:subsumes",
      "@type": "@id",
      "@container": "@set"
    },
    "subsumedBy": {
      "@id": "tori:subsumedBy",
      "@type": "@id",
      "@container": "@set"
    },
    "produces": {
      "@id": "tori:produces",
      "@type": "@id",
      "@container": "@set"
    },
    "consumes": {
      "@id": "tori:consumes",
      "@type": "@id",
      "@container": "@set"
    },
    "triggers": {
      "@id": "tori:triggers",
      "@type": "@id",
      "@container": "@set"
    },
    "subtaskOf": {
      "@id": "tori:subtaskOf",
      "@type": "@id"
    },
    "hasSubtask": {
      "@id": "tori:hasSubtask",
      "@type": "@id",
      "@container": "@set"
    },
    "currentStage": {
      "@id": "tori:currentStage",
      "@type": "@id"
    },
    "nextStage": {
      "@id": "tori:nextStage",
      "@type": "@id",
      "@container": "@set"
    },
    "previousStage": {
      "@id": "tori:previousStage",
      "@type": "@id"
    },
    "supersedes": {
      "@id": "tori:supersedes",
      "@type": "@id",
      "@container": "@set"
    },
    "supersededBy": {
      "@id": "tori:supersededBy",
      "@type": "@id"
    },
    "attestedBy": {
      "@id": "tori:attestedBy",
      "@type": "@id",
      "@container": "@set"
    },
    "enforces": {
      "@id": "tori:enforces",
      "@type": "@id",
      "@container": "@set"
    },
    "exempts": {
      "@id": "tori:exempts",
      "@type": "@id",
      "@container": "@set"
    },

    "agentId":          { "@id": "tori:agentId",          "@type": "xsd:string" },
    "agentName":        { "@id": "tori:agentName",        "@type": "xsd:string" },
    "agentDescription": { "@id": "tori:agentDescription", "@type": "xsd:string" },
    "agentVersion":     { "@id": "tori:agentVersion",     "@type": "xsd:string" },
    "modelId":          { "@id": "tori:modelId",          "@type": "xsd:string" },
    "systemPrompt":     { "@id": "tori:systemPrompt",     "@type": "xsd:string" },
    "maxTokenBudget":   { "@id": "tori:maxTokenBudget",   "@type": "xsd:integer" },
    "maxToolCalls":     { "@id": "tori:maxToolCalls",     "@type": "xsd:integer" },

    "roleId":          { "@id": "tori:roleId",          "@type": "xsd:string" },
    "roleName":        { "@id": "tori:roleName",        "@type": "xsd:string" },
    "roleDescription": { "@id": "tori:roleDescription", "@type": "xsd:string" },
    "roleScope":       { "@id": "tori:roleScope",       "@type": "xsd:string" },

    "capabilityId":          { "@id": "tori:capabilityId",          "@type": "xsd:string" },
    "capabilityName":        { "@id": "tori:capabilityName",        "@type": "xsd:string" },
    "capabilityDescription": { "@id": "tori:capabilityDescription", "@type": "xsd:string" },
    "capabilityType":        { "@id": "tori:capabilityType",        "@type": "xsd:string" },

    "skillId":          { "@id": "tori:skillId",          "@type": "xsd:string" },
    "skillName":        { "@id": "tori:skillName",        "@type": "xsd:string" },
    "skillDescription": { "@id": "tori:skillDescription", "@type": "xsd:string" },
    "skillVersion":     { "@id": "tori:skillVersion",     "@type": "xsd:string" },
    "parameterSchema":  { "@id": "tori:parameterSchema",  "@type": "xsd:string" },
    "skillContent":     { "@id": "tori:skillContent",     "@type": "xsd:string" },

    "toolId":       { "@id": "tori:toolId",       "@type": "xsd:string" },
    "toolName":     { "@id": "tori:toolName",     "@type": "xsd:string" },
    "toolEndpoint": { "@id": "tori:toolEndpoint", "@type": "xsd:string" },
    "commandPath":  { "@id": "tori:commandPath",  "@type": "xsd:string" },
    "toolVersion":  { "@id": "tori:toolVersion",  "@type": "xsd:string" },
    "isEnabled":    { "@id": "tori:isEnabled",    "@type": "xsd:boolean" },

    "taskId":          { "@id": "tori:taskId",          "@type": "xsd:string" },
    "taskTitle":       { "@id": "tori:taskTitle",        "@type": "xsd:string" },
    "taskDescription": { "@id": "tori:taskDescription",  "@type": "xsd:string" },
    "taskStatus":      { "@id": "tori:taskStatus",       "@type": "xsd:string" },
    "taskPriority":    { "@id": "tori:taskPriority",     "@type": "xsd:string" },
    "tokenBudget":     { "@id": "tori:tokenBudget",      "@type": "xsd:integer" },
    "toolCallBudget":  { "@id": "tori:toolCallBudget",   "@type": "xsd:integer" },

    "workflowId":   { "@id": "tori:workflowId",   "@type": "xsd:string" },
    "workflowName": { "@id": "tori:workflowName", "@type": "xsd:string" },
    "workflowDescription": { "@id": "tori:workflowDescription", "@type": "xsd:string" },

    "stageId":          { "@id": "tori:stageId",          "@type": "xsd:string" },
    "stageName":        { "@id": "tori:stageName",         "@type": "xsd:string" },
    "stageDescription": { "@id": "tori:stageDescription",  "@type": "xsd:string" },
    "stageOrder":       { "@id": "tori:stageOrder",        "@type": "xsd:integer" },

    "transitionId":    { "@id": "tori:transitionId",    "@type": "xsd:string" },
    "guardCondition":  { "@id": "tori:guardCondition",  "@type": "xsd:string" },
    "transitionLabel": { "@id": "tori:transitionLabel", "@type": "xsd:string" },

    "artifactId":     { "@id": "tori:artifactId",     "@type": "xsd:string" },
    "artifactName":   { "@id": "tori:artifactName",   "@type": "xsd:string" },
    "artifactType":   { "@id": "tori:artifactType",   "@type": "xsd:string" },
    "artifactStatus": { "@id": "tori:artifactStatus", "@type": "xsd:string" },
    "artifactPath":   { "@id": "tori:artifactPath",   "@type": "xsd:string" },
    "mimeType":       { "@id": "tori:mimeType",       "@type": "xsd:string" },
    "checksum":       { "@id": "tori:checksum",       "@type": "xsd:string" },

    "knowledgeId":      { "@id": "tori:knowledgeId",      "@type": "xsd:string" },
    "knowledgeContent": { "@id": "tori:knowledgeContent",  "@type": "xsd:string" },
    "confidenceScore":  { "@id": "tori:confidenceScore",   "@type": "xsd:decimal" },
    "knowledgeType":    { "@id": "tori:knowledgeType",     "@type": "xsd:string" },

    "policyId":     { "@id": "tori:policyId",     "@type": "xsd:string" },
    "policyName":   { "@id": "tori:policyName",   "@type": "xsd:string" },
    "policyEffect": { "@id": "tori:policyEffect", "@type": "xsd:string" },
    "policyRule":   { "@id": "tori:policyRule",   "@type": "xsd:string" },
    "priority":     { "@id": "tori:priority",     "@type": "xsd:integer" },

    "createdAt": { "@id": "tori:createdAt", "@type": "xsd:dateTime" },
    "updatedAt": { "@id": "tori:updatedAt", "@type": "xsd:dateTime" },
    "expiresAt": { "@id": "tori:expiresAt", "@type": "xsd:dateTime" },
    "version":   { "@id": "tori:version",   "@type": "xsd:string" },
    "label":     { "@id": "rdfs:label",     "@type": "xsd:string" },
    "comment":   { "@id": "rdfs:comment",   "@type": "xsd:string" }
  }
}
```

### 3.2 Context Validation Requirements

The context document MUST satisfy all of the following:

1. `"@version": 1.1` is present (enables JSON-LD 1.1 features including `@container: "@set"` on object properties).
2. All 8 namespace prefixes are declared: `tori`, `toria`, `owl`, `rdf`, `rdfs`, `xsd`, `sh`, `skos`.
3. All class terms are defined with `"@type": "@id"` (they are used as values of `@type`, which requires IRI coercion).
4. All object property terms are defined with `"@type": "@id"` and `"@container": "@set"` where multi-valued.
5. All datatype property terms are defined with the correct `xsd:` type.
6. No term is defined twice (duplicate keys in JSON are illegal in JSON-LD 1.1).
7. The document is valid JSON (parseable by `JSON.parse()`).

---

## 4. Serialization Rules

### 4.1 Document Structure

Every JSON-LD document produced or consumed by the tori-agent system MUST conform to the following structural rules:

**[NORMATIVE-S01]** Every document MUST include `@context`, either by reference (preferred) or inline:

```json
{ "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld" }
```

**[NORMATIVE-S02]** Every node MUST have `@id`. Blank nodes (e.g., `"@id": "_:b0"`) are permitted only in intermediate processing; they MUST be replaced with IRIs before persistence.

**[NORMATIVE-S03]** Every node MUST have `@type`. The type MUST be a class term defined in the context (Section 3.1) or a full IRI.

**[NORMATIVE-S04]** The root document MUST be either:
- A single node object with `@id` and `@type`, or
- An object with a `@graph` key containing an array of node objects.

The `@graph` form is REQUIRED for the Dynamic Knowledge Graph (multiple instances in one file).

**[NORMATIVE-S05]** Documents stored in `.opencode/knowledge-graph.jsonld` MUST use the `@graph` array form with a named graph IRI:

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "tori:graph/knowledge",
  "@graph": [...]
}
```

### 4.2 IRI Minting Rules

All instance IRIs MUST follow these patterns. The `tori:` prefix expands to `https://tori-agent.dev/ontology/2026/core#`.

| Class | IRI Pattern | Example |
|-------|-------------|---------|
| `Agent` | `toria:agent/{uuid-v4}` | `toria:agent/a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c` |
| `Role` | `toria:role/{slug}` | `toria:role/executor` |
| `Capability` | `toria:capability/{slug}` | `toria:capability/read-filesystem` |
| `Skill` | `toria:skill/{slug}` | `toria:skill/git-commit` |
| `Tool` | `toria:tool/{slug}` | `toria:tool/bash` |
| `Task` | `toria:task/{uuid-v4}` | `toria:task/7f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c` |
| `Workflow` | `toria:workflow/{slug}` | `toria:workflow/ontological-upgrade` |
| `Stage` | `toria:stage/{workflow-slug}/{stage-slug}` | `toria:stage/ontological-upgrade/execute` |
| `Transition` | `toria:transition/{from-slug}/{to-slug}` | `toria:transition/execute/verify` |
| `Artifact` | `toria:artifact/{uuid-v4}` | `toria:artifact/c2d3e4f5-6a7b-8c9d-0e1f-2a3b4c5d6e7f` |
| `Knowledge` | `toria:knowledge/{uuid-v4}` | `toria:knowledge/d4e5f6a7-8b9c-0d1e-2f3a-4b5c6d7e8f9a` |
| `Policy` | `toria:policy/{slug}` | `toria:policy/no-git-mutations` |

**Slug rules:**
- Lowercase ASCII letters, digits, and hyphens only.
- No leading or trailing hyphens.
- Maximum 64 characters.
- Derived from the human-readable name by: lowercasing, replacing spaces and underscores with hyphens, removing all other characters.

**UUID rules:**
- Version 4 (random) UUIDs only.
- Generated at instance creation time.
- Never reused, even after deletion.

### 4.3 Multi-valued Properties

**[NORMATIVE-S06]** All properties declared with `"@container": "@set"` in the context MUST be serialized as JSON arrays, even when only one value is present:

```json
"hasRole": ["toria:role/executor"]
```

NOT:

```json
"hasRole": "toria:role/executor"
```

**[NORMATIVE-S07]** Empty sets MUST be omitted entirely. Do not serialize empty arrays:

```json
{}
```

NOT:

```json
{ "hasRole": [] }
```

**Rationale:** The `@container: "@set"` annotation in JSON-LD 1.1 means that a single value and an array of one value are semantically equivalent after expansion. However, serializing single values as arrays prevents ambiguity in consumers that do not perform JSON-LD expansion before processing.

### 4.4 Enum Values

The following properties have a fixed set of allowed string values. Processors MUST reject documents with values outside these sets.

**Task Status** (`tori:taskStatus`):

| Value | Description |
|-------|-------------|
| `"Open"` | Task created but not yet started |
| `"Working"` | Task actively being executed |
| `"PendingReview"` | Task complete, awaiting review |
| `"Completed"` | Task accepted and closed |
| `"Cancelled"` | Task abandoned |
| `"Overdue"` | Task past deadline without completion |

**Artifact Type** (`tori:artifactType`):

| Value | Description |
|-------|-------------|
| `"Specification"` | Formal specification document |
| `"Plan"` | Execution plan |
| `"Brief"` | Project brief |
| `"Code"` | Source code file or module |
| `"Report"` | Analysis or status report |
| `"ADR"` | Architecture Decision Record |
| `"Changelog"` | Version changelog |

**Artifact Status** (`tori:artifactStatus`):

| Value | Description |
|-------|-------------|
| `"Draft"` | Under active authoring |
| `"Valid"` | Reviewed and accepted |
| `"Invalid"` | Failed validation |
| `"Superseded"` | Replaced by a newer version |
| `"Archived"` | Retained for historical reference |

**Policy Effect** (`tori:policyEffect`):

| Value | Description |
|-------|-------------|
| `"Allow"` | Grants the specified permission |
| `"Deny"` | Revokes or blocks the specified permission |

**Capability Type** (`tori:capabilityType`):

| Value | Description |
|-------|-------------|
| `"Tool"` | Authorizes invocation of a specific tool |
| `"Reasoning"` | Authorizes a reasoning operation |
| `"Domain"` | Authorizes access to a knowledge domain |

**Role Scope** (`tori:roleScope`):

| Value | Description |
|-------|-------------|
| `"global"` | Applies across all workflows |
| `"project"` | Applies within a specific project |
| `"task"` | Applies only during a specific task |

### 4.5 Temporal Values

**[NORMATIVE-S08]** All date and time values MUST be serialized as `xsd:dateTime` strings in ISO 8601 format with explicit timezone:

```
"2026-09-06T14:30:00Z"
"2026-09-06T14:30:00+05:30"
```

**[NORMATIVE-S09]** UTC is the RECOMMENDED timezone. Use the `Z` suffix for UTC.

**[NORMATIVE-S10]** Date-only values (without time component) are NOT permitted for `xsd:dateTime` properties. Use `"2026-09-06T00:00:00Z"` for midnight UTC when only a date is known.

---

## 5. Canonical Instance Examples

Each example is a complete, valid JSON-LD document in compacted form. All examples use `@context` by reference. All required properties (as defined in SC-02 SHACL shapes) are present.

### 5.1 Agent (AIAgent Subtype)

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:agent/a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
  "@type": "AIAgent",
  "agentId": "a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
  "agentName": "Specialist Executor",
  "agentDescription": "A pragmatic senior software engineer agent that executes well-defined implementation tasks.",
  "agentVersion": "1.0.0",
  "modelId": "kilo/stealth/claude-sonnet-4.6",
  "maxTokenBudget": 250000,
  "maxToolCalls": 20,
  "hasRole": [
    "toria:role/executor",
    "toria:role/code-writer"
  ],
  "hasTool": [
    "toria:tool/bash",
    "toria:tool/read",
    "toria:tool/write",
    "toria:tool/edit",
    "toria:tool/glob",
    "toria:tool/grep"
  ],
  "hasSkill": [
    "toria:skill/git-commit",
    "toria:skill/spec-writer",
    "toria:skill/direct-reasoning"
  ],
  "governedBy": [
    "toria:policy/no-git-mutations",
    "toria:policy/no-external-fetch",
    "toria:policy/single-task-scope"
  ],
  "createdAt": "2026-09-06T00:00:00Z",
  "updatedAt": "2026-09-06T14:30:00Z",
  "version": "1.0.0"
}
```

### 5.2 Role

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:role/executor",
  "@type": "Role",
  "roleId": "executor",
  "roleName": "Executor",
  "roleDescription": "Can read files, write files, run approved shell commands, and call MCP tools. Cannot commit to git, push, or fetch external resources.",
  "roleScope": "global",
  "grants": [
    "toria:capability/read-filesystem",
    "toria:capability/write-filesystem",
    "toria:capability/run-approved-commands",
    "toria:capability/call-mcp-tools"
  ],
  "createdAt": "2026-09-06T00:00:00Z",
  "version": "1.0.0"
}
```

### 5.3 Capability (ToolCapability Subtype)

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:capability/read-filesystem",
  "@type": "ToolCapability",
  "capabilityId": "read-filesystem",
  "capabilityName": "Read Filesystem",
  "capabilityDescription": "Authorizes reading files and directories from the local filesystem within the workspace root.",
  "capabilityType": "Tool",
  "bindsCapability": [
    "toria:tool/read",
    "toria:tool/glob",
    "toria:tool/grep"
  ],
  "createdAt": "2026-09-06T00:00:00Z",
  "version": "1.0.0"
}
```

### 5.4 Skill

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:skill/git-commit",
  "@type": "Skill",
  "skillId": "git-commit",
  "skillName": "Git Commit",
  "skillDescription": "Execute git commit with conventional commit message analysis, intelligent staging, and message generation.",
  "skillVersion": "1.0.0",
  "parameterSchema": "{\"type\":\"object\",\"properties\":{\"type\":{\"type\":\"string\",\"enum\":[\"feat\",\"fix\",\"docs\",\"chore\",\"refactor\",\"test\",\"ci\"]},\"scope\":{\"type\":\"string\"},\"description\":{\"type\":\"string\"}},\"required\":[\"description\"]}",
  "skillContent": "# Git Commit Skill\n\nExecute git commit following Conventional Commits specification...",
  "requiresCapability": [
    "toria:capability/run-approved-commands"
  ],
  "createdAt": "2026-09-06T00:00:00Z",
  "version": "1.0.0"
}
```

### 5.5 Tool (MCPTool Subtype)

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:tool/bash",
  "@type": "MCPTool",
  "toolId": "bash",
  "toolName": "Bash",
  "toolEndpoint": "mcp://localhost/bash",
  "toolVersion": "1.0.0",
  "isEnabled": true,
  "bindsCapability": [
    "toria:capability/run-approved-commands"
  ],
  "governedBy": [
    "toria:policy/bash-allowlist"
  ],
  "createdAt": "2026-09-06T00:00:00Z",
  "version": "1.0.0"
}
```

### 5.6 Task (AtomicTask Subtype)

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:task/7f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "@type": "AtomicTask",
  "taskId": "7f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "taskTitle": "Write JSON-LD Context Specification",
  "taskDescription": "Author the complete SC-04 specification document defining the normative JSON-LD context and all serialization rules for the tori-agent ontology.",
  "taskStatus": "Completed",
  "taskPriority": "High",
  "tokenBudget": 250000,
  "toolCallBudget": 20,
  "assignedTo": "toria:agent/a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
  "requiresCapability": [
    "toria:capability/write-filesystem",
    "toria:capability/read-filesystem"
  ],
  "produces": [
    "toria:artifact/c2d3e4f5-6a7b-8c9d-0e1f-2a3b4c5d6e7f"
  ],
  "belongsToWorkflow": "toria:workflow/ontological-upgrade",
  "governedBy": [
    "toria:policy/no-git-mutations",
    "toria:policy/no-external-fetch"
  ],
  "createdAt": "2026-09-06T00:00:00Z",
  "updatedAt": "2026-09-06T14:30:00Z",
  "version": "1.0.0"
}
```

### 5.7 Workflow

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:workflow/ontological-upgrade",
  "@type": "Workflow",
  "workflowId": "ontological-upgrade",
  "workflowName": "Ontological Upgrade",
  "workflowDescription": "Implements the Neuro-symbolic Triad: OWL ontology, SHACL shapes, Datalog policy engine, and JSON-LD serialization layer.",
  "hasStage": [
    "toria:stage/ontological-upgrade/plan",
    "toria:stage/ontological-upgrade/execute",
    "toria:stage/ontological-upgrade/verify",
    "toria:stage/ontological-upgrade/complete"
  ],
  "hasTransition": [
    "toria:transition/plan/execute",
    "toria:transition/execute/verify",
    "toria:transition/verify/execute",
    "toria:transition/verify/complete"
  ],
  "currentStage": "toria:stage/ontological-upgrade/execute",
  "governedBy": [
    "toria:policy/no-git-mutations"
  ],
  "createdAt": "2026-09-06T00:00:00Z",
  "updatedAt": "2026-09-06T14:30:00Z",
  "version": "1.0.0"
}
```

### 5.8 Stage

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:stage/ontological-upgrade/execute",
  "@type": "Stage",
  "stageId": "execute",
  "stageName": "Execute",
  "stageDescription": "Specialist agents implement the tasks defined in the exec-plan. Each agent receives a single, well-defined task.",
  "stageOrder": 2,
  "belongsToWorkflow": "toria:workflow/ontological-upgrade",
  "hasTransition": [
    "toria:transition/execute/verify"
  ],
  "createdAt": "2026-09-06T00:00:00Z",
  "version": "1.0.0"
}
```

### 5.9 Transition

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:transition/execute/verify",
  "@type": "Transition",
  "transitionId": "execute-to-verify",
  "transitionLabel": "Submit for Verification",
  "fromStage": "toria:stage/ontological-upgrade/execute",
  "toStage": "toria:stage/ontological-upgrade/verify",
  "guardCondition": "ALL tasks in execute stage have status IN [Completed, Cancelled]",
  "guardedBy": [
    "toria:policy/stage-transition-guard"
  ],
  "createdAt": "2026-09-06T00:00:00Z",
  "version": "1.0.0"
}
```

### 5.10 Artifact (Specification Subtype)

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:artifact/c2d3e4f5-6a7b-8c9d-0e1f-2a3b4c5d6e7f",
  "@type": "Specification",
  "artifactId": "c2d3e4f5-6a7b-8c9d-0e1f-2a3b4c5d6e7f",
  "artifactName": "Spec-SC-04: JSON-LD Context & Serialization",
  "artifactType": "Specification",
  "artifactStatus": "Draft",
  "artifactPath": "docs/specs/ontological-upgrade/spec-sc-04-jsonld-context.md",
  "mimeType": "text/markdown",
  "producedBy": "toria:agent/a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
  "reviewedBy": [],
  "dependsOn": [
    "toria:artifact/sc01-ontology-schema",
    "toria:artifact/sc02-shacl-shapes",
    "toria:artifact/sc03-datalog-policy"
  ],
  "governedBy": [
    "toria:policy/artifact-validation"
  ],
  "version": "0.1.0",
  "createdAt": "2026-09-06T14:30:00Z",
  "updatedAt": "2026-09-06T14:30:00Z"
}
```

### 5.11 Knowledge

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:knowledge/d4e5f6a7-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
  "@type": "DomainKnowledge",
  "knowledgeId": "d4e5f6a7-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
  "knowledgeContent": "JSON-LD 1.1 @container: @set semantics require that single-valued properties declared with this container annotation be serialized as arrays. This prevents consumer ambiguity when processing without full JSON-LD expansion.",
  "knowledgeType": "Domain",
  "confidenceScore": 0.98,
  "derivedFrom": [
    "toria:artifact/sc04-jsonld-context"
  ],
  "hasKnowledge": [],
  "createdAt": "2026-09-06T14:30:00Z",
  "updatedAt": "2026-09-06T14:30:00Z",
  "version": "1.0.0"
}
```

### 5.12 Policy (PermissionPolicy Subtype)

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:policy/no-git-mutations",
  "@type": "PermissionPolicy",
  "policyId": "no-git-mutations",
  "policyName": "No Git Mutations",
  "policyEffect": "Deny",
  "policyRule": "DENY bash WHERE command MATCHES /^git (add|commit|push|stash|switch|checkout|merge|rebase|reset|rm)/",
  "priority": 100,
  "appliesTo": [
    "tori:Agent"
  ],
  "exempts": [],
  "createdAt": "2026-09-06T00:00:00Z",
  "version": "1.0.0"
}
```

---

## 6. Three Graph Types — Serialization Patterns

### 6.1 Stable Ontology Graph

The Stable Ontology Graph contains the formal OWL class and property definitions. It is the machine-readable equivalent of SC-01.

**Characteristics:**
- **Content:** `owl:Class` declarations, `owl:ObjectProperty` and `owl:DatatypeProperty` definitions, `owl:disjointWith` axioms, `rdfs:subClassOf` relationships.
- **Primary format:** Turtle (`.ttl`) — more compact and readable than JSON-LD for ontology authoring.
- **Secondary format:** JSON-LD — generated from Turtle for programmatic consumption.
- **Location:** `packages/ontology/ontology/tori-ontology.ttl`
- **Update frequency:** Versioned releases only. Changes require a version bump in the ontology IRI.
- **Consumers:** OWL reasoners, SHACL validators (for target class resolution), documentation generators.

**Example: OWL Class Declaration in JSON-LD**

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@graph": [
    {
      "@id": "tori:Agent",
      "@type": "owl:Class",
      "label": "Agent",
      "comment": "An autonomous entity that executes tasks within a workflow.",
      "owl:disjointWith": [
        { "@id": "tori:Tool" },
        { "@id": "tori:Artifact" },
        { "@id": "tori:Policy" }
      ]
    },
    {
      "@id": "tori:AIAgent",
      "@type": "owl:Class",
      "label": "AI Agent",
      "comment": "An agent backed by a large language model.",
      "rdfs:subClassOf": { "@id": "tori:Agent" }
    },
    {
      "@id": "tori:hasRole",
      "@type": "owl:ObjectProperty",
      "label": "has role",
      "comment": "Assigns a Role to an Agent.",
      "rdfs:domain": { "@id": "tori:Agent" },
      "rdfs:range": { "@id": "tori:Role" }
    }
  ]
}
```

### 6.2 Dynamic Knowledge Graph

The Dynamic Knowledge Graph contains all project-specific instances. It is the living record of the current system state.

**Characteristics:**
- **Content:** `Agent`, `Task`, `Artifact`, `Workflow`, `Stage`, `Transition`, `Policy`, `Knowledge`, `Role`, `Capability`, `Skill`, `Tool` instances.
- **Primary format:** JSON-LD (compacted form).
- **Location:** `.opencode/knowledge-graph.jsonld`
- **Update frequency:** On every harness mutation (task creation, artifact update, stage transition, etc.).
- **Consumers:** Harness (reads/writes), SHACL validator (reads), Datalog EDB exporter (reads), agents (read via framing).
- **Serialization:** `@graph` array of named nodes, wrapped in a named graph IRI.

**Example: Running Workflow with Stages and Tasks**

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:graph/knowledge",
  "@graph": [
    {
      "@id": "toria:workflow/ontological-upgrade",
      "@type": "Workflow",
      "workflowId": "ontological-upgrade",
      "workflowName": "Ontological Upgrade",
      "currentStage": "toria:stage/ontological-upgrade/execute",
      "hasStage": [
        "toria:stage/ontological-upgrade/plan",
        "toria:stage/ontological-upgrade/execute",
        "toria:stage/ontological-upgrade/verify"
      ],
      "hasTransition": [
        "toria:transition/plan/execute",
        "toria:transition/execute/verify"
      ],
      "createdAt": "2026-09-06T00:00:00Z",
      "updatedAt": "2026-09-06T14:30:00Z",
      "version": "1.0.0"
    },
    {
      "@id": "toria:stage/ontological-upgrade/execute",
      "@type": "Stage",
      "stageId": "execute",
      "stageName": "Execute",
      "stageOrder": 2,
      "belongsToWorkflow": "toria:workflow/ontological-upgrade",
      "createdAt": "2026-09-06T00:00:00Z",
      "version": "1.0.0"
    },
    {
      "@id": "toria:task/7f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
      "@type": "AtomicTask",
      "taskId": "7f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
      "taskTitle": "Write JSON-LD Context Specification",
      "taskStatus": "Completed",
      "assignedTo": "toria:agent/a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
      "belongsToWorkflow": "toria:workflow/ontological-upgrade",
      "produces": ["toria:artifact/c2d3e4f5-6a7b-8c9d-0e1f-2a3b4c5d6e7f"],
      "createdAt": "2026-09-06T00:00:00Z",
      "updatedAt": "2026-09-06T14:30:00Z",
      "version": "1.0.0"
    },
    {
      "@id": "toria:task/8a4b2c3d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "@type": "AtomicTask",
      "taskId": "8a4b2c3d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "taskTitle": "Write SHACL Shapes Specification",
      "taskStatus": "Completed",
      "assignedTo": "toria:agent/a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
      "belongsToWorkflow": "toria:workflow/ontological-upgrade",
      "produces": ["toria:artifact/sc02-shacl-shapes"],
      "createdAt": "2026-09-06T00:00:00Z",
      "updatedAt": "2026-09-06T12:00:00Z",
      "version": "1.0.0"
    }
  ]
}
```

### 6.3 Ephemeral Execution Graph

The Ephemeral Execution Graph exists only in memory during a single workflow execution. It is never persisted to disk.

**Characteristics:**
- **Content:** In-flight task state, capability tokens (time-bounded grants), permission grants, intermediate reasoning results.
- **Format:** In-memory JSON-LD objects (JavaScript objects conforming to the context).
- **Lifetime:** Created when a workflow stage begins; destroyed when the stage ends or the process exits.
- **Consumers:** Harness policy engine (reads capability tokens before tool invocation), Datalog engine (reads permission grants for evaluation).

**Example: Capability Token Node**

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:token/e5f6a7b8-9c0d-1e2f-3a4b-5c6d7e8f9a0b",
  "@type": "DerivedCapability",
  "capabilityId": "e5f6a7b8-9c0d-1e2f-3a4b-5c6d7e8f9a0b",
  "capabilityName": "Ephemeral Write Token: SC-04 Task",
  "capabilityType": "Tool",
  "derivedFrom": [
    "toria:capability/write-filesystem"
  ],
  "assignedTo": "toria:agent/a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
  "appliesTo": [
    "toria:tool/write"
  ],
  "createdAt": "2026-09-06T14:00:00Z",
  "expiresAt": "2026-09-06T15:00:00Z",
  "version": "1.0.0"
}
```

**Lifecycle rules for ephemeral nodes:**
1. Tokens are created by the harness when a task is assigned to an agent.
2. The harness checks `expiresAt` before every tool invocation. Expired tokens cause `CapabilityExpiredError`.
3. Tokens are garbage-collected when the task transitions to `Completed` or `Cancelled`.
4. Tokens are never written to `.opencode/knowledge-graph.jsonld`.

---

## 7. JSON-LD Processing Pipeline

### 7.1 Pipeline Overview

The harness processes JSON-LD documents through a multi-stage pipeline that integrates all three tiers of the Neuro-symbolic Triad:

```
Input (JSON-LD compacted)
        │
        ▼
  [1] Expand
  jsonld.expand(doc, { documentLoader })
        │
        ▼
  [2] Convert to RDF Dataset
  jsonld.toRDF(expanded, { format: 'application/n-quads' })
        │
        ▼
  [3] SHACL Validation
  rdf-validate-shacl: validate(dataset, shapesGraph)
        │
        ├── sh:conforms: false → throw ValidationError (BLOCK)
        │
        ▼
  [4] Datalog EDB Export
  N-Quads → CSV fact files (agent.csv, task.csv, ...)
        │
        ▼
  [5] Datalog Evaluation
  Soufflé: evaluate(program, edbFacts)
        │
        ├── violation tuples → throw PolicyViolationError (BLOCK)
        │
        ▼
  [6] Compact
  jsonld.compact(expanded, context)
        │
        ▼
  Output (JSON-LD compacted)
```

### 7.2 TypeScript Implementation Sketch

```typescript
import jsonld from 'jsonld';
import type { JsonLdDocument, NodeObject } from 'jsonld';
import SHACLValidator from 'rdf-validate-shacl';
import { DataFactory, Store } from 'n3';
import { PolicyEngine } from './policy-engine.js';
import { EDBExporter } from './edb-exporter.js';

const CONTEXT_URL = 'https://tori-agent.dev/ontology/2026/core/context.jsonld';
const CONTEXT_LOCAL = new URL(
  '../../packages/ontology/context/tori-context.jsonld',
  import.meta.url
);

/** Custom document loader that resolves the canonical context URI to the local file. */
const documentLoader = jsonld.documentLoaders.node();
const customLoader = async (url: string) => {
  if (url === CONTEXT_URL) {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(CONTEXT_LOCAL, 'utf-8');
    return {
      contextUrl: null,
      documentUrl: url,
      document: JSON.parse(raw),
    };
  }
  return documentLoader(url);
};

export interface ProcessingResult {
  compacted: NodeObject;
  nquads: string;
  shaclConforms: boolean;
  shaclViolations: SHACLViolation[];
  policyViolations: PolicyViolation[];
}

export interface SHACLViolation {
  focusNode: string;
  resultPath: string;
  message: string;
  severity: 'Violation' | 'Warning';
}

export interface PolicyViolation {
  rule: string;
  subject: string;
  predicate: string;
  object: string;
}

export class ProcessingPipeline {
  private readonly shaclValidator: SHACLValidator;
  private readonly policyEngine: PolicyEngine;
  private readonly edbExporter: EDBExporter;

  constructor(
    shaclValidator: SHACLValidator,
    policyEngine: PolicyEngine,
    edbExporter: EDBExporter
  ) {
    this.shaclValidator = shaclValidator;
    this.policyEngine = policyEngine;
    this.edbExporter = edbExporter;
  }

  async process(doc: JsonLdDocument): Promise<ProcessingResult> {
    // [1] Expand: resolve all compact IRIs to full IRIs
    const expanded = await jsonld.expand(doc, { documentLoader });

    // [2] Convert to N-Quads for RDF processing
    const nquads = await jsonld.toRDF(expanded, {
      format: 'application/n-quads',
      documentLoader,
    }) as string;

    // [3] SHACL Validation
    const store = new Store();
    // Parse N-Quads into N3 Store for rdf-validate-shacl
    const { Parser } = await import('n3');
    const parser = new Parser({ format: 'N-Quads' });
    const quads = parser.parse(nquads);
    store.addQuads(quads);

    const report = await this.shaclValidator.validate(store);
    const shaclViolations: SHACLViolation[] = report.results.map(r => ({
      focusNode: r.focusNode?.value ?? '',
      resultPath: r.resultPath?.value ?? '',
      message: r.message?.[0]?.value ?? 'No message',
      severity: r.severity?.value?.includes('Violation') ? 'Violation' : 'Warning',
    }));

    if (!report.conforms) {
      const blocking = shaclViolations.filter(v => v.severity === 'Violation');
      if (blocking.length > 0) {
        throw new ValidationError(
          `SHACL validation failed with ${blocking.length} violation(s)`,
          blocking
        );
      }
    }

    // [4] Export EDB facts for Datalog
    const edbFacts = await this.edbExporter.export(nquads);

    // [5] Evaluate Datalog policy rules
    const policyResult = await this.policyEngine.evaluate(edbFacts);
    const policyViolations: PolicyViolation[] = policyResult.violations;

    if (policyViolations.length > 0) {
      throw new PolicyViolationError(
        `Policy evaluation produced ${policyViolations.length} violation(s)`,
        policyViolations
      );
    }

    // [6] Compact back to human-readable form
    const compacted = await jsonld.compact(expanded, CONTEXT_URL, {
      documentLoader,
    }) as NodeObject;

    return {
      compacted,
      nquads,
      shaclConforms: report.conforms,
      shaclViolations,
      policyViolations,
    };
  }
}

export class ValidationError extends Error {
  constructor(message: string, public readonly violations: SHACLViolation[]) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class PolicyViolationError extends Error {
  constructor(message: string, public readonly violations: PolicyViolation[]) {
    super(message);
    this.name = 'PolicyViolationError';
  }
}
```

### 7.3 npm Package Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `jsonld` | `^8.3.2` | JSON-LD 1.1 processing: expand, compact, flatten, frame, toRDF, fromRDF |
| `rdf-validate-shacl` | `^0.5.3` | SHACL validation over RDF datasets |
| `n3` | `^1.17.3` | N-Quads parsing, RDF Store, DataFactory |
| `@types/jsonld` | `^1.5.14` | TypeScript type definitions for jsonld |

---

## 8. Framing Patterns

JSON-LD Framing extracts a shaped subgraph from the Dynamic Knowledge Graph. The harness uses framing to inject relevant context into agent task assignments.

### 8.1 Agent Capability Frame

**Purpose:** Extract an agent with all its roles and effective capabilities. Used when the harness needs to determine what an agent is authorized to do before assigning a task.

**Frame document:**

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "Agent",
  "hasRole": {
    "@type": "Role",
    "grants": {
      "@type": "Capability"
    }
  },
  "hasTool": {
    "@type": "Tool"
  },
  "governedBy": {
    "@type": "Policy"
  }
}
```

**Example framed output:**

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:agent/a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
  "@type": "AIAgent",
  "agentId": "a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
  "agentName": "Specialist Executor",
  "agentVersion": "1.0.0",
  "hasRole": [
    {
      "@id": "toria:role/executor",
      "@type": "Role",
      "roleId": "executor",
      "roleName": "Executor",
      "roleScope": "global",
      "grants": [
        {
          "@id": "toria:capability/read-filesystem",
          "@type": "ToolCapability",
          "capabilityId": "read-filesystem",
          "capabilityName": "Read Filesystem",
          "capabilityType": "Tool"
        },
        {
          "@id": "toria:capability/write-filesystem",
          "@type": "ToolCapability",
          "capabilityId": "write-filesystem",
          "capabilityName": "Write Filesystem",
          "capabilityType": "Tool"
        }
      ]
    }
  ],
  "hasTool": [
    {
      "@id": "toria:tool/bash",
      "@type": "MCPTool",
      "toolId": "bash",
      "toolName": "Bash",
      "isEnabled": true
    },
    {
      "@id": "toria:tool/read",
      "@type": "FilesystemTool",
      "toolId": "read",
      "toolName": "Read",
      "isEnabled": true
    }
  ],
  "governedBy": [
    {
      "@id": "toria:policy/no-git-mutations",
      "@type": "PermissionPolicy",
      "policyId": "no-git-mutations",
      "policyEffect": "Deny"
    }
  ]
}
```

**TypeScript invocation:**

```typescript
const agentFrame = {
  "@context": CONTEXT_URL,
  "@type": "Agent",
  "hasRole": { "@type": "Role", "grants": { "@type": "Capability" } },
  "hasTool": { "@type": "Tool" },
  "governedBy": { "@type": "Policy" }
};

const framedAgent = await jsonld.frame(knowledgeGraph, agentFrame, { documentLoader });
```

### 8.2 Workflow Status Frame

**Purpose:** Extract a workflow with all its stages, transitions, and the status of all tasks in the current stage. Used by the harness to determine whether a stage transition is permitted.

**Frame document:**

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "Workflow",
  "hasStage": {
    "@type": "Stage"
  },
  "hasTransition": {
    "@type": "Transition",
    "fromStage": { "@type": "Stage" },
    "toStage": { "@type": "Stage" }
  },
  "currentStage": {
    "@type": "Stage"
  }
}
```

**Example framed output:**

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:workflow/ontological-upgrade",
  "@type": "Workflow",
  "workflowId": "ontological-upgrade",
  "workflowName": "Ontological Upgrade",
  "currentStage": {
    "@id": "toria:stage/ontological-upgrade/execute",
    "@type": "Stage",
    "stageId": "execute",
    "stageName": "Execute",
    "stageOrder": 2
  },
  "hasStage": [
    {
      "@id": "toria:stage/ontological-upgrade/plan",
      "@type": "Stage",
      "stageId": "plan",
      "stageName": "Plan",
      "stageOrder": 1
    },
    {
      "@id": "toria:stage/ontological-upgrade/execute",
      "@type": "Stage",
      "stageId": "execute",
      "stageName": "Execute",
      "stageOrder": 2
    },
    {
      "@id": "toria:stage/ontological-upgrade/verify",
      "@type": "Stage",
      "stageId": "verify",
      "stageName": "Verify",
      "stageOrder": 3
    }
  ],
  "hasTransition": [
    {
      "@id": "toria:transition/execute/verify",
      "@type": "Transition",
      "transitionId": "execute-to-verify",
      "guardCondition": "ALL tasks in execute stage have status IN [Completed, Cancelled]",
      "fromStage": {
        "@id": "toria:stage/ontological-upgrade/execute",
        "@type": "Stage",
        "stageId": "execute"
      },
      "toStage": {
        "@id": "toria:stage/ontological-upgrade/verify",
        "@type": "Stage",
        "stageId": "verify"
      }
    }
  ]
}
```

### 8.3 Artifact Provenance Frame

**Purpose:** Extract an artifact with its producer agent, all reviewer agents, and the full dependency chain (artifacts this artifact depends on). Used for provenance auditing and impact analysis.

**Frame document:**

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "Artifact",
  "producedBy": {
    "@type": "Agent"
  },
  "reviewedBy": {
    "@type": "Agent"
  },
  "dependsOn": {
    "@type": "Artifact",
    "producedBy": { "@type": "Agent" }
  }
}
```

**Example framed output:**

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:artifact/c2d3e4f5-6a7b-8c9d-0e1f-2a3b4c5d6e7f",
  "@type": "Specification",
  "artifactId": "c2d3e4f5-6a7b-8c9d-0e1f-2a3b4c5d6e7f",
  "artifactName": "Spec-SC-04: JSON-LD Context & Serialization",
  "artifactType": "Specification",
  "artifactStatus": "Draft",
  "artifactPath": "docs/specs/ontological-upgrade/spec-sc-04-jsonld-context.md",
  "version": "0.1.0",
  "producedBy": {
    "@id": "toria:agent/a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
    "@type": "AIAgent",
    "agentId": "a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
    "agentName": "Specialist Executor",
    "agentVersion": "1.0.0"
  },
  "reviewedBy": [],
  "dependsOn": [
    {
      "@id": "toria:artifact/sc01-ontology-schema",
      "@type": "Specification",
      "artifactId": "sc01-ontology-schema",
      "artifactName": "Spec-SC-01: Ontology Schema",
      "artifactStatus": "Draft",
      "producedBy": {
        "@id": "toria:agent/a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
        "@type": "AIAgent",
        "agentName": "Specialist Executor"
      }
    },
    {
      "@id": "toria:artifact/sc02-shacl-shapes",
      "@type": "Specification",
      "artifactId": "sc02-shacl-shapes",
      "artifactName": "Spec-SC-02: SHACL Shapes",
      "artifactStatus": "Draft",
      "producedBy": {
        "@id": "toria:agent/a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
        "@type": "AIAgent",
        "agentName": "Specialist Executor"
      }
    }
  ]
}
```

---

## 9. Context Versioning

### 9.1 Version URI Scheme

The context URI embeds the year as the version identifier:

```
https://tori-agent.dev/ontology/{year}/core/context.jsonld
```

Current version: `https://tori-agent.dev/ontology/2026/core/context.jsonld`

This scheme was chosen over semantic versioning (e.g., `v1.0.0`) because:
1. **Stability signals** — a year-based URI communicates that the context is stable for the duration of that year.
2. **Predictability** — consumers can anticipate when breaking changes will occur (at year boundaries).
3. **Alignment with OWL practice** — the Dublin Core, SKOS, and OWL namespaces all use year-based or date-based URIs.

### 9.2 Backward Compatibility Policy

Within a year (e.g., `2026`), the context MUST be backward compatible. Permitted changes:

| Change Type | Permitted? | Notes |
|-------------|-----------|-------|
| Add new class term | ✅ Yes | Additive; existing documents unaffected |
| Add new property term | ✅ Yes | Additive; existing documents unaffected |
| Add new enum value | ✅ Yes | Additive; existing validators must accept new values |
| Change `@type` of existing term | ❌ No | Breaking; requires new year |
| Change `@container` of existing term | ❌ No | Breaking; changes serialization shape |
| Remove existing term | ❌ No | Breaking; existing documents become invalid |
| Rename existing term | ❌ No | Breaking; equivalent to remove + add |
| Change namespace prefix IRI | ❌ No | Breaking; all IRIs change |

### 9.3 Breaking Change Process

When a breaking change is required:

1. Create a new year path: `https://tori-agent.dev/ontology/2027/core/context.jsonld`
2. Publish a migration guide documenting all breaking changes.
3. Maintain the `2026` context for at least 12 months after the `2027` context is published.
4. Update `packages/ontology/context/tori-context.jsonld` to point to the new version.
5. Update all instance documents in `.opencode/knowledge-graph.jsonld` to use the new context URI.

### 9.4 Local Resolution

During development, the canonical URI resolves to the local file via the custom document loader (Section 7.2). The mapping is:

```
https://tori-agent.dev/ontology/2026/core/context.jsonld
  → packages/ontology/context/tori-context.jsonld
```

In production deployments, the canonical URI MUST resolve to the same content via HTTP. The server MUST set `Content-Type: application/ld+json` and `Cache-Control: public, max-age=86400`.

### 9.5 Context Integrity

The context file MUST be accompanied by a SHA-256 checksum file at:

```
packages/ontology/context/tori-context.jsonld.sha256
```

Consumers SHOULD verify the checksum before processing. The harness MUST verify the checksum on startup.

---

## 10. Conformance Checklist

### 10.1 Context Document Conformance

| ID | Requirement | Level | Verification Method |
|----|-------------|-------|-------------------|
| C01 | `@context` document is valid JSON-LD 1.1 | NORMATIVE | `jsonld.expand(context)` succeeds without error |
| C02 | `"@version": 1.1` is present | NORMATIVE | JSON key check |
| C03 | All 8 namespace prefixes declared (`tori`, `toria`, `owl`, `rdf`, `rdfs`, `xsd`, `sh`, `skos`) | NORMATIVE | Key presence check |
| C04 | All 12 base class terms defined | NORMATIVE | Term presence check |
| C05 | All subclass terms defined (AIAgent, HumanAgent, HybridAgent, ToolCapability, ReasoningCapability, DomainCapability, DerivedCapability, MCPTool, FilesystemTool, NetworkTool, BuiltinTool, AtomicTask, CompositeTask, FileArtifact, DocumentArtifact, DataArtifact, SkillKnowledge, DomainKnowledge, PermissionPolicy, ConstraintPolicy, ValidationPolicy, AllowPolicy, DenyPolicy) | NORMATIVE | Term presence check |
| C06 | All object property terms defined with `"@type": "@id"` | NORMATIVE | Term schema check |
| C07 | All multi-valued object properties defined with `"@container": "@set"` | NORMATIVE | Term schema check |
| C08 | All datatype property terms defined with correct `xsd:` type | NORMATIVE | Term schema check |
| C09 | No duplicate term definitions | NORMATIVE | JSON key uniqueness check |
| C10 | Context document is valid JSON (parseable by `JSON.parse()`) | NORMATIVE | Parse check |

### 10.2 Instance Document Conformance

| ID | Requirement | Level | Verification Method |
|----|-------------|-------|-------------------|
| I01 | Every document includes `@context` | NORMATIVE | Key presence check |
| I02 | Every node has `@id` | NORMATIVE | SHACL shape check |
| I03 | Every node has `@type` | NORMATIVE | SHACL shape check |
| I04 | All IRIs follow the minting rules in Section 4.2 | NORMATIVE | IRI pattern validation |
| I05 | All multi-valued properties serialized as arrays | NORMATIVE | JSON schema check |
| I06 | Empty sets omitted (no `[]` values) | NORMATIVE | JSON schema check |
| I07 | All `taskStatus` values from the allowed enum | NORMATIVE | Value set check |
| I08 | All `artifactType` values from the allowed enum | NORMATIVE | Value set check |
| I09 | All `artifactStatus` values from the allowed enum | NORMATIVE | Value set check |
| I10 | All `policyEffect` values from the allowed enum | NORMATIVE | Value set check |
| I11 | All `capabilityType` values from the allowed enum | NORMATIVE | Value set check |
| I12 | All temporal values in ISO 8601 with timezone | NORMATIVE | Regex check |
| I13 | Expanded form round-trips to compact form without data loss | NORMATIVE | `expand → compact` identity check |
| I14 | All canonical examples validate against SC-02 SHACL shapes | NORMATIVE | SHACL validation |
| I15 | All canonical examples pass SC-03 Datalog policy evaluation | NORMATIVE | Datalog evaluation |

### 10.3 Processing Pipeline Conformance

| ID | Requirement | Level | Verification Method |
|----|-------------|-------|-------------------|
| P01 | Custom document loader resolves canonical URI to local file | NORMATIVE | Integration test |
| P02 | SHACL violations block pipeline (throw `ValidationError`) | NORMATIVE | Unit test with invalid document |
| P03 | SHACL warnings are logged but do not block | NORMATIVE | Unit test with warning-only document |
| P04 | Policy violations block pipeline (throw `PolicyViolationError`) | NORMATIVE | Unit test with policy-violating document |
| P05 | Ephemeral tokens are never written to `.opencode/knowledge-graph.jsonld` | NORMATIVE | Integration test |
| P06 | Context checksum verified on harness startup | RECOMMENDED | Startup log check |

---

## 11. Related Specs

| Spec | Title | Status | Relationship |
|------|-------|--------|--------------|
| SC-01 | Ontology Schema — Core Classes & Properties | draft | **Normative dependency** — context terms mirror SC-01 classes and properties. Every class and property defined in SC-01 MUST have a corresponding term in the SC-04 context. |
| SC-02 | SHACL Shapes for Ontology Validation | draft | **Normative companion** — all canonical instance examples in Section 5 MUST pass SHACL validation as defined in SC-02. The processing pipeline (Section 7) integrates SHACL validation as a blocking step. |
| SC-03 | Datalog Policy Engine | draft | **Normative companion** — the Datalog EDB facts are exported from the N-Quads representation of JSON-LD documents. The EDB schema (relation names and arities) is derived from the property terms defined in this context. |
| SC-05 | Ontology Registry & Versioning | draft | **Informative** — the registry manages context versions and provides the HTTP resolution infrastructure for canonical context URIs. |

---

## Appendix A: Property Index

Complete alphabetical index of all property terms defined in the context, with their RDF type and container annotation.

### A.1 Object Properties

| Term | Full IRI | Container | Notes |
|------|----------|-----------|-------|
| `appliesTo` | `tori:appliesTo` | `@set` | Policy → Agent/Class |
| `assignedTo` | `tori:assignedTo` | — | Task → Agent (exactly 1) |
| `attestedBy` | `tori:attestedBy` | `@set` | Artifact → Agent |
| `belongsToWorkflow` | `tori:belongsToWorkflow` | — | Stage/Task → Workflow |
| `bindsCapability` | `tori:bindsCapability` | `@set` | Tool/Capability → Capability |
| `canExecute` | `tori:canExecute` | `@set` | Agent → Task type |
| `canPerform` | `tori:canPerform` | `@set` | Agent → Capability (inferred) |
| `consumes` | `tori:consumes` | `@set` | Task → Artifact |
| `currentStage` | `tori:currentStage` | — | Workflow → Stage |
| `dependsOn` | `tori:dependsOn` | `@set` | Artifact → Artifact |
| `derivedFrom` | `tori:derivedFrom` | `@set` | Knowledge/Capability → source |
| `effectivelyHasCapability` | `tori:effectivelyHasCapability` | `@set` | Agent → Capability (inferred) |
| `enforces` | `tori:enforces` | `@set` | Policy → Rule |
| `executedBy` | `tori:executedBy` | — | Workflow → Agent |
| `exempts` | `tori:exempts` | `@set` | Policy → Agent/Class |
| `fromStage` | `tori:fromStage` | — | Transition → Stage |
| `governedBy` | `tori:governedBy` | `@set` | Agent/Task/Tool → Policy |
| `grants` | `tori:grants` | `@set` | Role → Capability |
| `guardedBy` | `tori:guardedBy` | `@set` | Transition → Policy |
| `hasKnowledge` | `tori:hasKnowledge` | `@set` | Agent/Workflow → Knowledge |
| `hasRole` | `tori:hasRole` | `@set` | Agent → Role |
| `hasSkill` | `tori:hasSkill` | `@set` | Agent → Skill |
| `hasStage` | `tori:hasStage` | `@set` | Workflow → Stage |
| `hasSubtask` | `tori:hasSubtask` | `@set` | CompositeTask → AtomicTask |
| `hasTool` | `tori:hasTool` | `@set` | Agent → Tool |
| `hasTransition` | `tori:hasTransition` | `@set` | Workflow/Stage → Transition |
| `inheritsFrom` | `tori:inheritsFrom` | `@set` | Role → Role |
| `invokes` | `tori:invokes` | `@set` | Task → Tool |
| `nextStage` | `tori:nextStage` | `@set` | Stage → Stage |
| `parameterizedBy` | `tori:parameterizedBy` | — | Skill → Schema |
| `participatesIn` | `tori:participatesIn` | `@set` | Agent → Workflow |
| `previousStage` | `tori:previousStage` | — | Stage → Stage |
| `producedBy` | `tori:producedBy` | — | Artifact → Agent |
| `produces` | `tori:produces` | `@set` | Task → Artifact |
| `requiresCapability` | `tori:requiresCapability` | `@set` | Task/Skill → Capability |
| `reviewedBy` | `tori:reviewedBy` | `@set` | Artifact → Agent |
| `subsumes` | `tori:subsumes` | `@set` | Capability → Capability |
| `subsumedBy` | `tori:subsumedBy` | `@set` | Capability → Capability |
| `subtaskOf` | `tori:subtaskOf` | — | AtomicTask → CompositeTask |
| `supersededBy` | `tori:supersededBy` | — | Artifact → Artifact |
| `supersedes` | `tori:supersedes` | `@set` | Artifact → Artifact |
| `toStage` | `tori:toStage` | — | Transition → Stage |
| `triggers` | `tori:triggers` | `@set` | Transition → Action |
| `assumesRole` | `tori:assumesRole` | `@set` | Agent → Role (dynamic) |

### A.2 Datatype Properties

| Term | Full IRI | XSD Type | Domain |
|------|----------|----------|--------|
| `agentDescription` | `tori:agentDescription` | `xsd:string` | Agent |
| `agentId` | `tori:agentId` | `xsd:string` | Agent |
| `agentName` | `tori:agentName` | `xsd:string` | Agent |
| `agentVersion` | `tori:agentVersion` | `xsd:string` | Agent |
| `artifactId` | `tori:artifactId` | `xsd:string` | Artifact |
| `artifactName` | `tori:artifactName` | `xsd:string` | Artifact |
| `artifactPath` | `tori:artifactPath` | `xsd:string` | Artifact |
| `artifactStatus` | `tori:artifactStatus` | `xsd:string` | Artifact |
| `artifactType` | `tori:artifactType` | `xsd:string` | Artifact |
| `capabilityDescription` | `tori:capabilityDescription` | `xsd:string` | Capability |
| `capabilityId` | `tori:capabilityId` | `xsd:string` | Capability |
| `capabilityName` | `tori:capabilityName` | `xsd:string` | Capability |
| `capabilityType` | `tori:capabilityType` | `xsd:string` | Capability |
| `checksum` | `tori:checksum` | `xsd:string` | Artifact |
| `commandPath` | `tori:commandPath` | `xsd:string` | FilesystemTool |
| `comment` | `rdfs:comment` | `xsd:string` | Any |
| `confidenceScore` | `tori:confidenceScore` | `xsd:decimal` | Knowledge |
| `createdAt` | `tori:createdAt` | `xsd:dateTime` | Any |
| `expiresAt` | `tori:expiresAt` | `xsd:dateTime` | DerivedCapability |
| `guardCondition` | `tori:guardCondition` | `xsd:string` | Transition |
| `isEnabled` | `tori:isEnabled` | `xsd:boolean` | Tool |
| `knowledgeContent` | `tori:knowledgeContent` | `xsd:string` | Knowledge |
| `knowledgeId` | `tori:knowledgeId` | `xsd:string` | Knowledge |
| `knowledgeType` | `tori:knowledgeType` | `xsd:string` | Knowledge |
| `label` | `rdfs:label` | `xsd:string` | Any |
| `maxTokenBudget` | `tori:maxTokenBudget` | `xsd:integer` | Agent |
| `maxToolCalls` | `tori:maxToolCalls` | `xsd:integer` | Agent |
| `mimeType` | `tori:mimeType` | `xsd:string` | Artifact |
| `modelId` | `tori:modelId` | `xsd:string` | AIAgent |
| `parameterSchema` | `tori:parameterSchema` | `xsd:string` | Skill |
| `policyEffect` | `tori:policyEffect` | `xsd:string` | Policy |
| `policyId` | `tori:policyId` | `xsd:string` | Policy |
| `policyName` | `tori:policyName` | `xsd:string` | Policy |
| `policyRule` | `tori:policyRule` | `xsd:string` | Policy |
| `priority` | `tori:priority` | `xsd:integer` | Policy |
| `roleDescription` | `tori:roleDescription` | `xsd:string` | Role |
| `roleId` | `tori:roleId` | `xsd:string` | Role |
| `roleName` | `tori:roleName` | `xsd:string` | Role |
| `roleScope` | `tori:roleScope` | `xsd:string` | Role |
| `skillContent` | `tori:skillContent` | `xsd:string` | Skill |
| `skillDescription` | `tori:skillDescription` | `xsd:string` | Skill |
| `skillId` | `tori:skillId` | `xsd:string` | Skill |
| `skillName` | `tori:skillName` | `xsd:string` | Skill |
| `skillVersion` | `tori:skillVersion` | `xsd:string` | Skill |
| `stageDescription` | `tori:stageDescription` | `xsd:string` | Stage |
| `stageId` | `tori:stageId` | `xsd:string` | Stage |
| `stageName` | `tori:stageName` | `xsd:string` | Stage |
| `stageOrder` | `tori:stageOrder` | `xsd:integer` | Stage |
| `systemPrompt` | `tori:systemPrompt` | `xsd:string` | Agent |
| `taskDescription` | `tori:taskDescription` | `xsd:string` | Task |
| `taskId` | `tori:taskId` | `xsd:string` | Task |
| `taskPriority` | `tori:taskPriority` | `xsd:string` | Task |
| `taskStatus` | `tori:taskStatus` | `xsd:string` | Task |
| `taskTitle` | `tori:taskTitle` | `xsd:string` | Task |
| `tokenBudget` | `tori:tokenBudget` | `xsd:integer` | Task |
| `toolCallBudget` | `tori:toolCallBudget` | `xsd:integer` | Task |
| `toolEndpoint` | `tori:toolEndpoint` | `xsd:string` | MCPTool |
| `toolId` | `tori:toolId` | `xsd:string` | Tool |
| `toolName` | `tori:toolName` | `xsd:string` | Tool |
| `toolVersion` | `tori:toolVersion` | `xsd:string` | Tool |
| `transitionId` | `tori:transitionId` | `xsd:string` | Transition |
| `transitionLabel` | `tori:transitionLabel` | `xsd:string` | Transition |
| `updatedAt` | `tori:updatedAt` | `xsd:dateTime` | Any |
| `version` | `tori:version` | `xsd:string` | Any |
| `workflowDescription` | `tori:workflowDescription` | `xsd:string` | Workflow |
| `workflowId` | `tori:workflowId` | `xsd:string` | Workflow |
| `workflowName` | `tori:workflowName` | `xsd:string` | Workflow |

---

## Appendix B: Round-Trip Verification

This appendix demonstrates that the compacted form round-trips through expand → compact without data loss.

### B.1 Input (Compacted)

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:role/executor",
  "@type": "Role",
  "roleId": "executor",
  "roleName": "Executor",
  "roleScope": "global",
  "grants": ["toria:capability/read-filesystem"]
}
```

### B.2 Expanded Form

```json
[
  {
    "@id": "https://tori-agent.dev/ontology/2026/agent#role/executor",
    "@type": ["https://tori-agent.dev/ontology/2026/core#Role"],
    "https://tori-agent.dev/ontology/2026/core#roleId": [
      { "@value": "executor", "@type": "http://www.w3.org/2001/XMLSchema#string" }
    ],
    "https://tori-agent.dev/ontology/2026/core#roleName": [
      { "@value": "Executor", "@type": "http://www.w3.org/2001/XMLSchema#string" }
    ],
    "https://tori-agent.dev/ontology/2026/core#roleScope": [
      { "@value": "global", "@type": "http://www.w3.org/2001/XMLSchema#string" }
    ],
    "https://tori-agent.dev/ontology/2026/core#grants": [
      { "@id": "https://tori-agent.dev/ontology/2026/agent#capability/read-filesystem" }
    ]
  }
]
```

### B.3 Re-compacted Form

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@id": "toria:role/executor",
  "@type": "Role",
  "roleId": "executor",
  "roleName": "Executor",
  "roleScope": "global",
  "grants": ["toria:capability/read-filesystem"]
}
```

The re-compacted form is identical to the input. Round-trip verified. ✅

---

*End of [Spec-SC-04] JSON-LD Context & Serialization*
