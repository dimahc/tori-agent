---
title: "[Spec-SC-01] Ontology Schema — Core Classes & Properties"
status: draft
created: "2026-09-06"
spec_id: SC-01
domain: ontological-upgrade
version: "0.1.0"
authors:
  - tori-agent ontology team
related_specs:
  - spec-sc-02-shacl-shapes.md
  - spec-sc-03-datalog-policy.md
  - spec-sc-04-jsonld-context.md
---

# [Spec-SC-01] Ontology Schema — Core Classes & Properties

## Executive Summary

This specification is the **source of truth** for the tori-agent Ontological Upgrade's class hierarchy, property definitions, and inter-class relationships. It defines the 12 core ontological classes that together form the semantic backbone of the system.

The architecture follows the **Neuro-symbolic Triad**:

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Meaning** | JSON-LD / OWL 2 DL | Formal semantics, class hierarchy, object properties |
| **Validation** | SHACL (Shapes Constraint Language) | Instance conformance, cardinality enforcement |
| **Policy** | Datalog (Soufflé dialect) | Capability inference, permission propagation, executability |

All three layers are normative. An implementation is conformant only if it satisfies all three simultaneously.

### Namespace

```
@prefix tori:  <https://tori-agent.dev/ontology/2026/core#> .
@prefix toria: <https://tori-agent.dev/ontology/2026/agent#> .
@prefix sh:    <http://www.w3.org/ns/shacl#> .
@prefix owl:   <http://www.w3.org/2002/07/owl#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
```

The canonical IRI for this ontology version is:
`https://tori-agent.dev/ontology/2026/core`

---

## Class Hierarchy Overview

```
owl:Thing
├── tori:Agent
│   └── tori:SpecialistAgent
├── tori:Role
├── tori:Capability
│   └── tori:DerivedCapability
├── tori:Skill
├── tori:Tool
│   ├── tori:MCPTool
│   └── tori:BuiltinTool
├── tori:Task
│   ├── tori:AtomicTask
│   └── tori:CompositeTask
├── tori:Workflow
├── tori:Stage
├── tori:Transition
├── tori:Artifact
│   ├── tori:FileArtifact
│   ├── tori:DocumentArtifact
│   └── tori:DataArtifact
├── tori:Knowledge
│   ├── tori:SkillKnowledge
│   └── tori:DomainKnowledge
└── tori:Policy
    ├── tori:AllowPolicy
    └── tori:DenyPolicy
```

---

## 1. Class: `tori:Agent`

### 1.1 Formal Definition

> An **Agent** is an autonomous computational entity capable of perceiving its environment, reasoning over a knowledge base, and executing tasks by invoking tools and skills. Agents operate within a Workflow under the governance of Policies.

**OWL axiom:**
```turtle
tori:Agent a owl:Class ;
  rdfs:label "Agent" ;
  rdfs:comment "An autonomous entity that executes tasks within a workflow." ;
  owl:disjointWith tori:Tool, tori:Artifact, tori:Policy .
```

### 1.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:agentId` | `xsd:string` | exactly 1 | Agent | — | Globally unique identifier (UUID v4) |
| `tori:agentName` | `xsd:string` | exactly 1 | Agent | — | Human-readable display name |
| `tori:agentVersion` | `xsd:string` | exactly 1 | Agent | — | Semantic version string (e.g. `"1.2.0"`) |
| `tori:modelId` | `xsd:string` | min 0, max 1 | Agent | — | Backing LLM model identifier |
| `tori:systemPrompt` | `xsd:string` | min 0, max 1 | Agent | — | Base system prompt text |
| `tori:maxTokenBudget` | `xsd:integer` | min 0, max 1 | Agent | — | Token budget ceiling per invocation |
| `tori:maxToolCalls` | `xsd:integer` | min 0, max 1 | Agent | — | Maximum tool calls per invocation |
| `tori:hasRole` | Object | min 1 | Agent | Role | Roles assigned to this agent |
| `tori:hasTool` | Object | min 0 | Agent | Tool | Tools available to this agent |
| `tori:hasSkill` | Object | min 0 | Agent | Skill | Skills loaded by this agent |
| `tori:canPerform` | Object | min 0 | Agent | Capability | Effective capabilities (inferred) |
| `tori:governedBy` | Object | min 0 | Agent | Policy | Policies that constrain this agent |
| `tori:participatesIn` | Object | min 0 | Agent | Workflow | Workflows this agent is registered in |

### 1.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:Agent",
  "@id": "toria:agent/specialist-executor-v1",
  "tori:agentId": "a3f7c2d1-8b4e-4f9a-b6c3-1d2e5f8a9b0c",
  "tori:agentName": "Specialist Executor",
  "tori:agentVersion": "1.0.0",
  "tori:modelId": "kilo/stealth/claude-sonnet-4.6",
  "tori:maxTokenBudget": 250000,
  "tori:maxToolCalls": 20,
  "tori:hasRole": [
    { "@id": "toria:role/executor" },
    { "@id": "toria:role/code-writer" }
  ],
  "tori:hasTool": [
    { "@id": "toria:tool/bash" },
    { "@id": "toria:tool/read" },
    { "@id": "toria:tool/write" },
    { "@id": "toria:tool/edit" }
  ],
  "tori:hasSkill": [
    { "@id": "toria:skill/git-commit" },
    { "@id": "toria:skill/spec-writer" }
  ],
  "tori:governedBy": [
    { "@id": "toria:policy/no-git-mutations" },
    { "@id": "toria:policy/no-external-fetch" }
  ]
}
```

### 1.4 Object Property Participation

- **Subject of:** `hasRole`, `hasTool`, `hasSkill`, `canPerform`, `governedBy`, `participatesIn`, `canExecute`
- **Object of:** `assignedTo` (from Task), `executedBy` (from Workflow)

---

## 2. Class: `tori:Role`

### 2.1 Formal Definition

> A **Role** is a named set of Capabilities that can be granted to an Agent. Roles implement the principle of least privilege: an Agent's effective capabilities are the union of capabilities granted by all its assigned Roles, intersected with Policy permissions.

**OWL axiom:**
```turtle
tori:Role a owl:Class ;
  rdfs:label "Role" ;
  rdfs:comment "A named bundle of capabilities assignable to an Agent." ;
  owl:disjointWith tori:Agent, tori:Tool, tori:Artifact .
```

### 2.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:roleId` | `xsd:string` | exactly 1 | Role | — | Unique role identifier |
| `tori:roleName` | `xsd:string` | exactly 1 | Role | — | Human-readable role name |
| `tori:roleDescription` | `xsd:string` | min 0, max 1 | Role | — | Prose description of role purpose |
| `tori:grants` | Object | min 1 | Role | Capability | Capabilities this role grants |
| `tori:inheritsFrom` | Object | min 0 | Role | Role | Parent roles (capability inheritance) |
| `tori:roleScope` | `xsd:string` | exactly 1 | Role | — | Scope: `"global"`, `"project"`, `"task"` |

### 2.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:Role",
  "@id": "toria:role/executor",
  "tori:roleId": "executor",
  "tori:roleName": "Executor",
  "tori:roleDescription": "Can read files, write files, run approved shell commands, and call MCP tools.",
  "tori:roleScope": "global",
  "tori:grants": [
    { "@id": "toria:capability/read-filesystem" },
    { "@id": "toria:capability/write-filesystem" },
    { "@id": "toria:capability/run-approved-commands" },
    { "@id": "toria:capability/call-mcp-tools" }
  ]
}
```

### 2.4 Object Property Participation

- **Subject of:** `grants`, `inheritsFrom`
- **Object of:** `hasRole` (from Agent)

---

## 3. Class: `tori:Capability`

### 3.1 Formal Definition

> A **Capability** is an atomic, named permission that authorizes an Agent to perform a specific class of action. Capabilities are the primitive unit of the permission model. They are granted by Roles, required by Tasks, and constrained by Policies.

**OWL axiom:**
```turtle
tori:Capability a owl:Class ;
  rdfs:label "Capability" ;
  rdfs:comment "An atomic permission authorizing a specific class of action." ;
  owl:disjointWith tori:Agent, tori:Tool, tori:Task .

tori:DerivedCapability rdfs:subClassOf tori:Capability ;
  rdfs:comment "A capability inferred via axioms rather than directly declared." .
```

### 3.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:capabilityId` | `xsd:string` | exactly 1 | Capability | — | Unique capability identifier |
| `tori:capabilityName` | `xsd:string` | exactly 1 | Capability | — | Human-readable name |
| `tori:capabilityCategory` | `xsd:string` | exactly 1 | Capability | — | Category: `"filesystem"`, `"network"`, `"execution"`, `"knowledge"`, `"communication"` |
| `tori:capabilityDescription` | `xsd:string` | min 0, max 1 | Capability | — | Prose description |
| `tori:implies` | Object | min 0 | Capability | Capability | Weaker capabilities implied by this one |
| `tori:requiredBy` | Object | min 0 | Capability | Task | Tasks that require this capability |
| `tori:providedBy` | Object | min 0 | Capability | Tool | Tools that provide this capability |

### 3.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:Capability",
  "@id": "toria:capability/write-filesystem",
  "tori:capabilityId": "write-filesystem",
  "tori:capabilityName": "Write Filesystem",
  "tori:capabilityCategory": "filesystem",
  "tori:capabilityDescription": "Authorizes creating and modifying files within allowed path patterns.",
  "tori:implies": [
    { "@id": "toria:capability/read-filesystem" }
  ]
}
```

### 3.4 Object Property Participation

- **Subject of:** `implies`, `requiredBy`, `providedBy`
- **Object of:** `grants` (from Role), `canPerform` (from Agent), `requires` (from Task), `provides` (from Tool)

---

## 4. Class: `tori:Skill`

### 4.1 Formal Definition

> A **Skill** is a reusable, versioned instruction set that augments an Agent's reasoning or execution behavior for a specific domain. Skills are loaded at runtime and injected into the Agent's context. Unlike Tools (which are executable functions), Skills are declarative knowledge artifacts.

**OWL axiom:**
```turtle
tori:Skill a owl:Class ;
  rdfs:label "Skill" ;
  rdfs:comment "A versioned instruction set that augments Agent behavior for a domain." ;
  owl:disjointWith tori:Tool, tori:Policy .
```

### 4.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:skillId` | `xsd:string` | exactly 1 | Skill | — | Unique skill identifier |
| `tori:skillName` | `xsd:string` | exactly 1 | Skill | — | Human-readable name |
| `tori:skillVersion` | `xsd:string` | exactly 1 | Skill | — | Semantic version |
| `tori:skillLocation` | `xsd:anyURI` | exactly 1 | Skill | — | Filesystem path or URI to SKILL.md |
| `tori:skillDescription` | `xsd:string` | min 0, max 1 | Skill | — | Trigger conditions and purpose |
| `tori:skillTriggers` | `xsd:string` | min 0 | Skill | — | Trigger phrases (repeatable) |
| `tori:enablesCapability` | Object | min 0 | Skill | Capability | Capabilities this skill enables |
| `tori:dependsOnSkill` | Object | min 0 | Skill | Skill | Other skills this skill depends on |
| `tori:applicableTo` | Object | min 0 | Skill | Role | Roles for which this skill is relevant |

### 4.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:Skill",
  "@id": "toria:skill/spec-writer",
  "tori:skillId": "spec-writer",
  "tori:skillName": "Spec Writer",
  "tori:skillVersion": "1.0.0",
  "tori:skillLocation": ".opencode/skills/spec-writer/SKILL.md",
  "tori:skillDescription": "Guide for writing specification documents in the managed specs directory.",
  "tori:skillTriggers": [
    "write a spec",
    "new spec",
    "spec this feature",
    "flesh out the spec",
    "is this spec complete"
  ],
  "tori:enablesCapability": [
    { "@id": "toria:capability/write-specification" }
  ],
  "tori:applicableTo": [
    { "@id": "toria:role/scribe" },
    { "@id": "toria:role/executor" }
  ]
}
```

### 4.4 Object Property Participation

- **Subject of:** `enablesCapability`, `dependsOnSkill`, `applicableTo`
- **Object of:** `hasSkill` (from Agent)

---

## 5. Class: `tori:Tool`

### 5.1 Formal Definition

> A **Tool** is an executable function or external service endpoint that an Agent can invoke to produce side effects or retrieve information. Tools are the primary mechanism by which Agents interact with the environment. Each Tool provides one or more Capabilities and may require specific Capabilities to invoke.

**OWL axiom:**
```turtle
tori:Tool a owl:Class ;
  rdfs:label "Tool" ;
  rdfs:comment "An executable function or service endpoint invocable by an Agent." ;
  owl:disjointWith tori:Agent, tori:Skill, tori:Policy .

tori:MCPTool rdfs:subClassOf tori:Tool ;
  rdfs:comment "A tool exposed via the Model Context Protocol." .

tori:BuiltinTool rdfs:subClassOf tori:Tool ;
  rdfs:comment "A tool built into the agent runtime." .
```

### 5.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:toolId` | `xsd:string` | exactly 1 | Tool | — | Unique tool identifier |
| `tori:toolName` | `xsd:string` | exactly 1 | Tool | — | Human-readable name |
| `tori:toolVersion` | `xsd:string` | min 0, max 1 | Tool | — | Tool version |
| `tori:toolType` | `xsd:string` | exactly 1 | Tool | — | `"mcp"`, `"builtin"`, `"shell"`, `"api"` |
| `tori:toolSchema` | `xsd:string` | min 0, max 1 | Tool | — | JSON Schema for tool parameters |
| `tori:provides` | Object | min 1 | Tool | Capability | Capabilities this tool provides |
| `tori:requiresCapability` | Object | min 0 | Tool | Capability | Capabilities needed to invoke this tool |
| `tori:producesArtifact` | Object | min 0 | Tool | Artifact | Artifact types this tool can produce |
| `tori:consumesArtifact` | Object | min 0 | Tool | Artifact | Artifact types this tool reads |
| `tori:serverName` | `xsd:string` | min 0, max 1 | MCPTool | — | MCP server name (MCPTool only) |

### 5.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:MCPTool",
  "@id": "toria:tool/bash",
  "tori:toolId": "bash",
  "tori:toolName": "Bash",
  "tori:toolType": "builtin",
  "tori:toolSchema": "{\"type\":\"object\",\"properties\":{\"command\":{\"type\":\"string\"},\"timeout\":{\"type\":\"integer\"},\"workdir\":{\"type\":\"string\"}},\"required\":[\"command\"]}",
  "tori:provides": [
    { "@id": "toria:capability/run-approved-commands" },
    { "@id": "toria:capability/read-filesystem" }
  ],
  "tori:requiresCapability": [
    { "@id": "toria:capability/run-approved-commands" }
  ]
}
```

### 5.4 Object Property Participation

- **Subject of:** `provides`, `requiresCapability`, `producesArtifact`, `consumesArtifact`
- **Object of:** `hasTool` (from Agent)

---

## 6. Class: `tori:Task`

### 6.1 Formal Definition

> A **Task** is a discrete unit of work with defined preconditions (required Capabilities and input Artifacts) and postconditions (produced Artifacts and state changes). Tasks are the atomic schedulable units within a Workflow. A Task is executable by an Agent if and only if the Agent possesses all required Capabilities.

**OWL axiom:**
```turtle
tori:Task a owl:Class ;
  rdfs:label "Task" ;
  rdfs:comment "A discrete unit of work with defined pre- and postconditions." ;
  owl:disjointWith tori:Agent, tori:Tool, tori:Policy .

tori:AtomicTask rdfs:subClassOf tori:Task ;
  rdfs:comment "A task that cannot be decomposed further." .

tori:CompositeTask rdfs:subClassOf tori:Task ;
  rdfs:comment "A task composed of sub-tasks." .
```

### 6.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:taskId` | `xsd:string` | exactly 1 | Task | — | Unique task identifier |
| `tori:taskName` | `xsd:string` | exactly 1 | Task | — | Human-readable name |
| `tori:taskDescription` | `xsd:string` | min 0, max 1 | Task | — | Prose description of work |
| `tori:taskStatus` | `xsd:string` | exactly 1 | Task | — | `"pending"`, `"running"`, `"completed"`, `"failed"`, `"cancelled"` |
| `tori:taskPriority` | `xsd:integer` | min 0, max 1 | Task | — | Scheduling priority (higher = more urgent) |
| `tori:requires` | Object | min 0 | Task | Capability | Capabilities required to execute |
| `tori:consumes` | Object | min 0 | Task | Artifact | Input artifacts consumed |
| `tori:produces` | Object | min 0 | Task | Artifact | Output artifacts produced |
| `tori:assignedTo` | Object | min 0, max 1 | Task | Agent | Agent assigned to execute this task |
| `tori:dependsOn` | Object | min 0 | Task | Task | Tasks that must complete before this one |
| `tori:partOf` | Object | min 0, max 1 | Task | Workflow | Workflow this task belongs to |
| `tori:governedBy` | Object | min 0 | Task | Policy | Policies constraining this task |
| `tori:hasSubTask` | Object | min 0 | CompositeTask | Task | Sub-tasks (CompositeTask only) |

### 6.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:AtomicTask",
  "@id": "toria:task/write-spec-sc-01",
  "tori:taskId": "write-spec-sc-01",
  "tori:taskName": "Write Ontology Schema Spec",
  "tori:taskDescription": "Author the complete SC-01 ontology schema specification document.",
  "tori:taskStatus": "completed",
  "tori:taskPriority": 10,
  "tori:requires": [
    { "@id": "toria:capability/write-filesystem" },
    { "@id": "toria:capability/write-specification" }
  ],
  "tori:consumes": [
    { "@id": "toria:artifact/ontological-upgrade-brief" }
  ],
  "tori:produces": [
    { "@id": "toria:artifact/spec-sc-01-ontology-schema" }
  ],
  "tori:assignedTo": { "@id": "toria:agent/specialist-executor-v1" },
  "tori:partOf": { "@id": "toria:workflow/ontological-upgrade-wf-01" }
}
```

### 6.4 Object Property Participation

- **Subject of:** `requires`, `consumes`, `produces`, `assignedTo`, `dependsOn`, `partOf`, `governedBy`, `hasSubTask`
- **Object of:** `dependsOn` (from Task), `hasSubTask` (from CompositeTask), `containsTask` (from Workflow)

---

## 7. Class: `tori:Workflow`

### 7.1 Formal Definition

> A **Workflow** is a directed acyclic graph (DAG) of Stages and Transitions that orchestrates the execution of Tasks to achieve a defined goal. Workflows have a lifecycle governed by a state machine: they begin in an initial Stage, progress through intermediate Stages via Transitions, and terminate in a terminal Stage.

**OWL axiom:**
```turtle
tori:Workflow a owl:Class ;
  rdfs:label "Workflow" ;
  rdfs:comment "A DAG of Stages and Transitions orchestrating Task execution." ;
  owl:disjointWith tori:Agent, tori:Tool, tori:Artifact .
```

### 7.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:workflowId` | `xsd:string` | exactly 1 | Workflow | — | Unique workflow identifier |
| `tori:workflowName` | `xsd:string` | exactly 1 | Workflow | — | Human-readable name |
| `tori:workflowVersion` | `xsd:string` | exactly 1 | Workflow | — | Semantic version |
| `tori:workflowStatus` | `xsd:string` | exactly 1 | Workflow | — | `"draft"`, `"active"`, `"paused"`, `"completed"`, `"aborted"` |
| `tori:initialStage` | Object | exactly 1 | Workflow | Stage | The starting Stage |
| `tori:terminalStage` | Object | min 1 | Workflow | Stage | Terminal (accepting) Stages |
| `tori:hasStage` | Object | min 2 | Workflow | Stage | All Stages in this workflow |
| `tori:hasTransition` | Object | min 1 | Workflow | Transition | All Transitions in this workflow |
| `tori:containsTask` | Object | min 0 | Workflow | Task | Tasks scheduled within this workflow |
| `tori:executedBy` | Object | min 0 | Workflow | Agent | Agents participating in this workflow |
| `tori:producesArtifact` | Object | min 0 | Workflow | Artifact | Artifacts produced by this workflow |
| `tori:governedBy` | Object | min 0 | Workflow | Policy | Policies governing this workflow |

### 7.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:Workflow",
  "@id": "toria:workflow/ontological-upgrade-wf-01",
  "tori:workflowId": "ontological-upgrade-wf-01",
  "tori:workflowName": "Ontological Upgrade — Phase 1",
  "tori:workflowVersion": "0.1.0",
  "tori:workflowStatus": "active",
  "tori:initialStage": { "@id": "toria:stage/plan" },
  "tori:terminalStage": [
    { "@id": "toria:stage/completed" },
    { "@id": "toria:stage/aborted" }
  ],
  "tori:hasStage": [
    { "@id": "toria:stage/plan" },
    { "@id": "toria:stage/execute" },
    { "@id": "toria:stage/verify" },
    { "@id": "toria:stage/completed" }
  ],
  "tori:executedBy": [
    { "@id": "toria:agent/specialist-executor-v1" }
  ]
}
```

### 7.4 Object Property Participation

- **Subject of:** `initialStage`, `terminalStage`, `hasStage`, `hasTransition`, `containsTask`, `executedBy`, `producesArtifact`, `governedBy`
- **Object of:** `partOf` (from Task), `participatesIn` (from Agent)

---

## 8. Class: `tori:Stage`

### 8.1 Formal Definition

> A **Stage** is a named state within a Workflow's state machine. Each Stage has an associated set of Tasks that must be completed before the Workflow can transition out of that Stage. Stages are either initial, intermediate, or terminal.

**OWL axiom:**
```turtle
tori:Stage a owl:Class ;
  rdfs:label "Stage" ;
  rdfs:comment "A named state in a Workflow's state machine." ;
  owl:disjointWith tori:Agent, tori:Tool, tori:Artifact .
```

### 8.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:stageId` | `xsd:string` | exactly 1 | Stage | — | Unique stage identifier |
| `tori:stageName` | `xsd:string` | exactly 1 | Stage | — | Human-readable name |
| `tori:stageType` | `xsd:string` | exactly 1 | Stage | — | `"initial"`, `"intermediate"`, `"terminal"` |
| `tori:stageDescription` | `xsd:string` | min 0, max 1 | Stage | — | Prose description |
| `tori:entryCondition` | `xsd:string` | min 0 | Stage | — | Condition expression for entry |
| `tori:exitCondition` | `xsd:string` | min 0 | Stage | — | Condition expression for exit |
| `tori:stageTask` | Object | min 0 | Stage | Task | Tasks associated with this stage |
| `tori:outgoingTransition` | Object | min 0 | Stage | Transition | Transitions leaving this stage |
| `tori:incomingTransition` | Object | min 0 | Stage | Transition | Transitions entering this stage |
| `tori:belongsTo` | Object | exactly 1 | Stage | Workflow | Workflow this stage belongs to |

### 8.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:Stage",
  "@id": "toria:stage/execute",
  "tori:stageId": "execute",
  "tori:stageName": "Execute",
  "tori:stageType": "intermediate",
  "tori:stageDescription": "Agent executes the delegated task block.",
  "tori:entryCondition": "plan.status == 'approved'",
  "tori:exitCondition": "all(task.status == 'completed' for task in stage.tasks)",
  "tori:outgoingTransition": [
    { "@id": "toria:transition/execute-to-verify" },
    { "@id": "toria:transition/execute-to-correction" }
  ],
  "tori:incomingTransition": [
    { "@id": "toria:transition/plan-to-execute" }
  ],
  "tori:belongsTo": { "@id": "toria:workflow/ontological-upgrade-wf-01" }
}
```

### 8.4 Object Property Participation

- **Subject of:** `stageTask`, `outgoingTransition`, `incomingTransition`, `belongsTo`
- **Object of:** `initialStage`, `terminalStage`, `hasStage` (from Workflow), `fromStage`, `toStage` (from Transition)

---

## 9. Class: `tori:Transition`

### 9.1 Formal Definition

> A **Transition** is a directed edge in the Workflow state machine connecting a source Stage to a target Stage. A Transition fires when its guard condition evaluates to true. Transitions may carry side effects (e.g., triggering notifications, updating artifact status).

**OWL axiom:**
```turtle
tori:Transition a owl:Class ;
  rdfs:label "Transition" ;
  rdfs:comment "A directed edge in the Workflow state machine with a guard condition." ;
  owl:disjointWith tori:Agent, tori:Tool, tori:Artifact .
```

### 9.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:transitionId` | `xsd:string` | exactly 1 | Transition | — | Unique transition identifier |
| `tori:transitionName` | `xsd:string` | exactly 1 | Transition | — | Human-readable name |
| `tori:fromStage` | Object | exactly 1 | Transition | Stage | Source stage |
| `tori:toStage` | Object | exactly 1 | Transition | Stage | Target stage |
| `tori:guardCondition` | `xsd:string` | min 0, max 1 | Transition | — | Boolean expression that must be true |
| `tori:transitionPolicy` | `xsd:string` | min 0, max 1 | Transition | — | `"auto"`, `"manual"`, `"approval"` |
| `tori:sideEffect` | `xsd:string` | min 0 | Transition | — | Side effects triggered on firing |
| `tori:precondition` | Object | min 0 | Transition | Artifact | Artifacts that must exist before firing |
| `tori:postcondition` | Object | min 0 | Transition | Artifact | Artifacts that must exist after firing |

### 9.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:Transition",
  "@id": "toria:transition/execute-to-verify",
  "tori:transitionId": "execute-to-verify",
  "tori:transitionName": "Execute → Verify",
  "tori:fromStage": { "@id": "toria:stage/execute" },
  "tori:toStage": { "@id": "toria:stage/verify" },
  "tori:guardCondition": "all_blocks_checked(plan) AND no_unchecked_blocks(plan)",
  "tori:transitionPolicy": "auto",
  "tori:sideEffect": "trigger_mechanical_checks()",
  "tori:precondition": [
    { "@id": "toria:artifact/exec-plan" }
  ],
  "tori:postcondition": [
    { "@id": "toria:artifact/verification-report" }
  ]
}
```

### 9.4 Object Property Participation

- **Subject of:** `fromStage`, `toStage`, `precondition`, `postcondition`
- **Object of:** `outgoingTransition`, `incomingTransition` (from Stage), `hasTransition` (from Workflow)

---

## 10. Class: `tori:Artifact`

### 10.1 Formal Definition

> An **Artifact** is a persistent, versioned data object produced or consumed by Tasks. Artifacts are the primary mechanism for inter-Task data exchange and for establishing provenance chains. Every Artifact has a type, a location, and a lifecycle status.

**OWL axiom:**
```turtle
tori:Artifact a owl:Class ;
  rdfs:label "Artifact" ;
  rdfs:comment "A persistent, versioned data object produced or consumed by Tasks." ;
  owl:disjointWith tori:Agent, tori:Tool, tori:Policy .

tori:FileArtifact rdfs:subClassOf tori:Artifact ;
  rdfs:comment "An artifact stored as a file on the filesystem." .

tori:DocumentArtifact rdfs:subClassOf tori:Artifact ;
  rdfs:comment "An artifact that is a structured document (spec, plan, brief)." .

tori:DataArtifact rdfs:subClassOf tori:Artifact ;
  rdfs:comment "An artifact that is a structured data payload (JSON, YAML)." .
```

### 10.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:artifactId` | `xsd:string` | exactly 1 | Artifact | — | Unique artifact identifier |
| `tori:artifactName` | `xsd:string` | exactly 1 | Artifact | — | Human-readable name |
| `tori:artifactType` | `xsd:string` | exactly 1 | Artifact | — | `"file"`, `"document"`, `"data"`, `"report"` |
| `tori:artifactStatus` | `xsd:string` | exactly 1 | Artifact | — | `"pending"`, `"exists"`, `"stale"`, `"deleted"` |
| `tori:artifactLocation` | `xsd:anyURI` | min 0, max 1 | Artifact | — | Filesystem path or URI |
| `tori:artifactMimeType` | `xsd:string` | min 0, max 1 | Artifact | — | MIME type |
| `tori:artifactVersion` | `xsd:string` | min 0, max 1 | Artifact | — | Version string |
| `tori:artifactChecksum` | `xsd:string` | min 0, max 1 | Artifact | — | SHA-256 checksum |
| `tori:producedBy` | Object | min 0, max 1 | Artifact | Task | Task that produced this artifact |
| `tori:consumedBy` | Object | min 0 | Artifact | Task | Tasks that consume this artifact |
| `tori:derivedFrom` | Object | min 0 | Artifact | Artifact | Source artifacts this was derived from |
| `tori:containsKnowledge` | Object | min 0 | Artifact | Knowledge | Knowledge encoded in this artifact |

### 10.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:DocumentArtifact",
  "@id": "toria:artifact/spec-sc-01-ontology-schema",
  "tori:artifactId": "spec-sc-01-ontology-schema",
  "tori:artifactName": "Ontology Schema Specification SC-01",
  "tori:artifactType": "document",
  "tori:artifactStatus": "exists",
  "tori:artifactLocation": "docs/specs/ontological-upgrade/spec-sc-01-ontology-schema.md",
  "tori:artifactMimeType": "text/markdown",
  "tori:artifactVersion": "0.1.0",
  "tori:producedBy": { "@id": "toria:task/write-spec-sc-01" },
  "tori:derivedFrom": [
    { "@id": "toria:artifact/ontological-upgrade-brief" },
    { "@id": "toria:artifact/agentic-ontology-treatise" }
  ]
}
```

### 10.4 Object Property Participation

- **Subject of:** `producedBy`, `consumedBy`, `derivedFrom`, `containsKnowledge`
- **Object of:** `consumes`, `produces` (from Task), `producesArtifact`, `consumesArtifact` (from Tool/Workflow), `precondition`, `postcondition` (from Transition)

---

## 11. Class: `tori:Knowledge`

### 11.1 Formal Definition

> **Knowledge** is a structured, reusable information unit that informs Agent reasoning. Knowledge instances are distinct from Skills (which are instruction sets) and Artifacts (which are data objects). Knowledge represents facts, rules, heuristics, or domain models that persist across invocations.

**OWL axiom:**
```turtle
tori:Knowledge a owl:Class ;
  rdfs:label "Knowledge" ;
  rdfs:comment "A structured information unit informing Agent reasoning." ;
  owl:disjointWith tori:Tool, tori:Policy .

tori:SkillKnowledge rdfs:subClassOf tori:Knowledge ;
  rdfs:comment "Knowledge embedded in a Skill." .

tori:DomainKnowledge rdfs:subClassOf tori:Knowledge ;
  rdfs:comment "Domain-specific facts and heuristics." .
```

### 11.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:knowledgeId` | `xsd:string` | exactly 1 | Knowledge | — | Unique knowledge identifier |
| `tori:knowledgeName` | `xsd:string` | exactly 1 | Knowledge | — | Human-readable name |
| `tori:knowledgeType` | `xsd:string` | exactly 1 | Knowledge | — | `"fact"`, `"rule"`, `"heuristic"`, `"model"`, `"procedure"` |
| `tori:knowledgeContent` | `xsd:string` | exactly 1 | Knowledge | — | The knowledge content (text, JSON, Datalog) |
| `tori:knowledgeDomain` | `xsd:string` | min 0 | Knowledge | — | Domain tags (repeatable) |
| `tori:knowledgeConfidence` | `xsd:decimal` | min 0, max 1 | Knowledge | — | Confidence score [0.0, 1.0] |
| `tori:sourceArtifact` | Object | min 0 | Knowledge | Artifact | Artifact this knowledge was extracted from |
| `tori:appliesTo` | Object | min 0 | Knowledge | Role | Roles for which this knowledge is relevant |
| `tori:supersedes` | Object | min 0 | Knowledge | Knowledge | Older knowledge this supersedes |

### 11.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:DomainKnowledge",
  "@id": "toria:knowledge/node-builtin-import-rule",
  "tori:knowledgeId": "node-builtin-import-rule",
  "tori:knowledgeName": "Node.js Built-in Import Protocol Rule",
  "tori:knowledgeType": "rule",
  "tori:knowledgeContent": "Node.js built-in imports MUST use the 'node:' protocol prefix. Example: import fs from 'node:fs', NOT import fs from 'fs'. Enforced as ESLint error.",
  "tori:knowledgeDomain": ["nodejs", "typescript", "eslint", "conventions"],
  "tori:knowledgeConfidence": 1.0,
  "tori:sourceArtifact": { "@id": "toria:artifact/agents-md" },
  "tori:appliesTo": [
    { "@id": "toria:role/executor" },
    { "@id": "toria:role/code-writer" }
  ]
}
```

### 11.4 Object Property Participation

- **Subject of:** `sourceArtifact`, `appliesTo`, `supersedes`
- **Object of:** `containsKnowledge` (from Artifact)

---

## 12. Class: `tori:Policy`

### 12.1 Formal Definition

> A **Policy** is a normative rule that constrains Agent behavior, Tool invocation, or Workflow progression. Policies implement the governance layer of the system. They are evaluated at runtime and can allow or deny specific actions. The effective permission set of an Agent is the intersection of its declared capabilities, role-granted capabilities, and policy permissions.

**OWL axiom:**
```turtle
tori:Policy a owl:Class ;
  rdfs:label "Policy" ;
  rdfs:comment "A normative rule constraining Agent behavior or Workflow progression." ;
  owl:disjointWith tori:Agent, tori:Tool, tori:Artifact .

tori:AllowPolicy rdfs:subClassOf tori:Policy ;
  rdfs:comment "A policy that explicitly permits an action." .

tori:DenyPolicy rdfs:subClassOf tori:Policy ;
  rdfs:comment "A policy that explicitly prohibits an action." .
```

### 12.2 Property Table

| Property | Type | Cardinality | Domain | Range | Description |
|----------|------|-------------|--------|-------|-------------|
| `tori:policyId` | `xsd:string` | exactly 1 | Policy | — | Unique policy identifier |
| `tori:policyName` | `xsd:string` | exactly 1 | Policy | — | Human-readable name |
| `tori:policyType` | `xsd:string` | exactly 1 | Policy | — | `"allow"`, `"deny"` |
| `tori:policyPriority` | `xsd:integer` | exactly 1 | Policy | — | Evaluation priority (higher = evaluated first) |
| `tori:policyPattern` | `xsd:string` | min 1 | Policy | — | Glob or regex pattern for matching (repeatable) |
| `tori:policyScope` | `xsd:string` | exactly 1 | Policy | — | `"tool"`, `"path"`, `"command"`, `"network"`, `"workflow"` |
| `tori:policyRationale` | `xsd:string` | min 0, max 1 | Policy | — | Human-readable justification |
| `tori:appliesTo` | Object | min 0 | Policy | Agent | Agents this policy applies to |
| `tori:appliesToRole` | Object | min 0 | Policy | Role | Roles this policy applies to |
| `tori:restricts` | Object | min 0 | Policy | Capability | Capabilities this policy restricts |
| `tori:overrides` | Object | min 0 | Policy | Policy | Lower-priority policies this overrides |

### 12.3 JSON-LD Instance Example

```json
{
  "@context": "https://tori-agent.dev/ontology/2026/core/context.jsonld",
  "@type": "tori:DenyPolicy",
  "@id": "toria:policy/no-git-mutations",
  "tori:policyId": "no-git-mutations",
  "tori:policyName": "No Git Mutations",
  "tori:policyType": "deny",
  "tori:policyPriority": 100,
  "tori:policyPattern": [
    "git add *",
    "git commit *",
    "git push *",
    "git stash *",
    "git switch *"
  ],
  "tori:policyScope": "command",
  "tori:policyRationale": "Tori owns the git lifecycle. Executor agents must not commit, push, or switch branches.",
  "tori:appliesTo": [
    { "@id": "toria:agent/specialist-executor-v1" }
  ],
  "tori:restricts": [
    { "@id": "toria:capability/run-approved-commands" }
  ]
}
```

### 12.4 Object Property Participation

- **Subject of:** `appliesTo`, `appliesToRole`, `restricts`, `overrides`
- **Object of:** `governedBy` (from Agent, Task, Workflow)

---

## 13. Master Object Property Table

This table enumerates all object properties (relationships) defined across the ontology.

| Property | Domain | Range | Cardinality | Inverse | Transitive |
|----------|--------|-------|-------------|---------|-----------|
| `tori:hasRole` | Agent | Role | min 1 | `tori:assignedToAgent` | No |
| `tori:hasTool` | Agent | Tool | min 0 | `tori:availableToAgent` | No |
| `tori:hasSkill` | Agent | Skill | min 0 | `tori:loadedByAgent` | No |
| `tori:canPerform` | Agent | Capability | min 0 | `tori:performableBy` | No |
| `tori:governedBy` | Agent ∪ Task ∪ Workflow | Policy | min 0 | `tori:governs` | No |
| `tori:participatesIn` | Agent | Workflow | min 0 | `tori:executedBy` | No |
| `tori:canExecute` | Agent | Task | min 0 | `tori:executableBy` | No |
| `tori:grants` | Role | Capability | min 1 | `tori:grantedBy` | No |
| `tori:inheritsFrom` | Role | Role | min 0 | `tori:inheritedBy` | **Yes** |
| `tori:implies` | Capability | Capability | min 0 | `tori:impliedBy` | **Yes** |
| `tori:requiredBy` | Capability | Task | min 0 | `tori:requires` | No |
| `tori:providedBy` | Capability | Tool | min 0 | `tori:provides` | No |
| `tori:enablesCapability` | Skill | Capability | min 0 | `tori:enabledBySkill` | No |
| `tori:dependsOnSkill` | Skill | Skill | min 0 | `tori:dependedOnBySkill` | No |
| `tori:applicableTo` | Skill | Role | min 0 | `tori:hasApplicableSkill` | No |
| `tori:provides` | Tool | Capability | min 1 | `tori:providedBy` | No |
| `tori:requiresCapability` | Tool | Capability | min 0 | `tori:requiredByTool` | No |
| `tori:producesArtifact` | Tool ∪ Workflow | Artifact | min 0 | `tori:producedByTool` | No |
| `tori:consumesArtifact` | Tool | Artifact | min 0 | `tori:consumedByTool` | No |
| `tori:requires` | Task | Capability | min 0 | `tori:requiredBy` | No |
| `tori:consumes` | Task | Artifact | min 0 | `tori:consumedBy` | No |
| `tori:produces` | Task | Artifact | min 0 | `tori:producedBy` | No |
| `tori:assignedTo` | Task | Agent | max 1 | `tori:canExecute` | No |
| `tori:dependsOn` | Task | Task | min 0 | `tori:dependedOnBy` | **Yes** |
| `tori:partOf` | Task | Workflow | max 1 | `tori:containsTask` | No |
| `tori:hasSubTask` | CompositeTask | Task | min 0 | `tori:subTaskOf` | No |
| `tori:initialStage` | Workflow | Stage | exactly 1 | `tori:isInitialStageOf` | No |
| `tori:terminalStage` | Workflow | Stage | min 1 | `tori:isTerminalStageOf` | No |
| `tori:hasStage` | Workflow | Stage | min 2 | `tori:belongsTo` | No |
| `tori:hasTransition` | Workflow | Transition | min 1 | `tori:transitionOf` | No |
| `tori:containsTask` | Workflow | Task | min 0 | `tori:partOf` | No |
| `tori:executedBy` | Workflow | Agent | min 0 | `tori:participatesIn` | No |
| `tori:stageTask` | Stage | Task | min 0 | `tori:inStage` | No |
| `tori:outgoingTransition` | Stage | Transition | min 0 | `tori:fromStage` | No |
| `tori:incomingTransition` | Stage | Transition | min 0 | `tori:toStage` | No |
| `tori:belongsTo` | Stage | Workflow | exactly 1 | `tori:hasStage` | No |
| `tori:fromStage` | Transition | Stage | exactly 1 | `tori:outgoingTransition` | No |
| `tori:toStage` | Transition | Stage | exactly 1 | `tori:incomingTransition` | No |
| `tori:precondition` | Transition | Artifact | min 0 | `tori:preconditionOf` | No |
| `tori:postcondition` | Transition | Artifact | min 0 | `tori:postconditionOf` | No |
| `tori:producedBy` | Artifact | Task | max 1 | `tori:produces` | No |
| `tori:consumedBy` | Artifact | Task | min 0 | `tori:consumes` | No |
| `tori:derivedFrom` | Artifact | Artifact | min 0 | `tori:derivedInto` | **Yes** |
| `tori:containsKnowledge` | Artifact | Knowledge | min 0 | `tori:sourceArtifact` | No |
| `tori:sourceArtifact` | Knowledge | Artifact | min 0 | `tori:containsKnowledge` | No |
| `tori:appliesTo` | Knowledge ∪ Policy | Role ∪ Agent | min 0 | `tori:hasApplicableKnowledge` | No |
| `tori:supersedes` | Knowledge | Knowledge | min 0 | `tori:supersededBy` | No |
| `tori:appliesToRole` | Policy | Role | min 0 | `tori:hasApplicablePolicy` | No |
| `tori:restricts` | Policy | Capability | min 0 | `tori:restrictedBy` | No |
| `tori:overrides` | Policy | Policy | min 0 | `tori:overriddenBy` | No |

---

## 14. Relational Axioms

These axioms are normative. Implementations MUST enforce them. They are expressed in pseudo-Datalog and natural language.

### C1: Capability Transitivity via Role

**Natural language:** If an Agent has a Role, and that Role grants a Capability, then the Agent can perform that Capability.

**Datalog:**
```datalog
canPerform(Agent, Cap) :-
  hasRole(Agent, Role),
  grants(Role, Cap).

canPerform(Agent, Cap) :-
  hasRole(Agent, Role),
  inheritsFrom(Role, ParentRole),
  grants(ParentRole, Cap).
```

**OWL property chain:**
```turtle
tori:canPerform owl:propertyChainAxiom (tori:hasRole tori:grants) .
```

**Implication:** Role inheritance is transitive (via `inheritsFrom`), so capability propagation follows the full role hierarchy.

---

### C2: Tool-Capability Binding

**Natural language:** If a Tool provides a Capability, and an Agent has that Tool, then the Agent can perform that Capability.

**Datalog:**
```datalog
canPerform(Agent, Cap) :-
  hasTool(Agent, Tool),
  provides(Tool, Cap).
```

**OWL property chain:**
```turtle
tori:canPerform owl:propertyChainAxiom (tori:hasTool tori:provides) .
```

**Implication:** Tool availability is a source of capability, independent of Role grants. Both sources contribute to the effective capability set.

---

### C3: Task Executability

**Natural language:** An Agent can execute a Task if and only if the Agent can perform all Capabilities required by the Task.

**Datalog:**
```datalog
canExecute(Agent, Task) :-
  not missingCapability(Agent, Task).

missingCapability(Agent, Task) :-
  requires(Task, Cap),
  not canPerform(Agent, Cap).
```

**Constraint:** `canExecute` is a derived property — it must not be asserted directly; it must be inferred.

---

### C4: Artifact Dependency

**Natural language:** If a Task consumes an Artifact, that Artifact must exist (status = `"exists"`) before the Task can execute.

**Datalog:**
```datalog
taskBlocked(Task) :-
  consumes(Task, Artifact),
  not artifactExists(Artifact).

artifactExists(Artifact) :-
  artifactStatus(Artifact, "exists").
```

**Enforcement:** The Workflow engine MUST check `taskBlocked` before scheduling any Task. A blocked Task must not be dispatched.

---

### C5: Producer Completeness

**Natural language:** If a Task consumes an Artifact, there must exist at least one other Task in the same Workflow that produces that Artifact.

**Datalog:**
```datalog
artifactOrphan(Artifact) :-
  consumedBy(Artifact, _),
  not producedBy(Artifact, _),
  not externalArtifact(Artifact).

violation(C5, Artifact) :- artifactOrphan(Artifact).
```

**Note:** External artifacts (those not produced within the Workflow) must be explicitly declared with `tori:externalArtifact true` to suppress this violation.

---

### C6: Permission Monotonicity

**Natural language:** The effective capabilities of an Agent are the intersection of: (a) capabilities declared on the Agent, (b) capabilities granted by the Agent's Roles, and (c) capabilities permitted by applicable Policies.

**Formal:**
```
EffectiveCapabilities(Agent) =
  DeclaredCapabilities(Agent)
  ∩ RoleCapabilities(Agent)
  ∩ PolicyPermissions(Agent)
```

**Datalog:**
```datalog
effectiveCapability(Agent, Cap) :-
  canPerform(Agent, Cap),
  not policyDenies(Agent, Cap).

policyDenies(Agent, Cap) :-
  governedBy(Agent, Policy),
  restricts(Policy, Cap),
  policyType(Policy, "deny").
```

**Monotonicity invariant:** Adding a DenyPolicy can only reduce the effective capability set, never increase it. Adding an AllowPolicy can only increase it if the capability was already in the Role-granted set.

---

### C7: Workflow Transition Validity

**Natural language:** A Workflow Transition from Stage A to Stage B is valid if and only if: (a) the guard condition of the Transition evaluates to true, (b) all precondition Artifacts exist, and (c) all Tasks in Stage A have status `"completed"`.

**Datalog:**
```datalog
transitionValid(T) :-
  fromStage(T, StageA),
  toStage(T, StageB),
  guardSatisfied(T),
  allPreconditionsExist(T),
  allStageTasksComplete(StageA).

allStageTasksComplete(Stage) :-
  not incompleteStageTask(Stage).

incompleteStageTask(Stage) :-
  stageTask(Stage, Task),
  not taskStatus(Task, "completed").

allPreconditionsExist(T) :-
  not missingPrecondition(T).

missingPrecondition(T) :-
  precondition(T, Artifact),
  not artifactExists(Artifact).
```

---

## 15. Normative JSON-LD @context

This is the canonical `@context` block for the tori-agent ontology. All JSON-LD instances in this specification and in conformant implementations MUST use this context (or a superset that does not redefine any term).

```json
{
  "@context": {
    "@version": 1.1,
    "tori": "https://tori-agent.dev/ontology/2026/core#",
    "toria": "https://tori-agent.dev/ontology/2026/agent#",
    "owl": "http://www.w3.org/2002/07/owl#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "sh": "http://www.w3.org/ns/shacl#",

    "Agent":       { "@id": "tori:Agent",      "@type": "@id" },
    "Role":        { "@id": "tori:Role",        "@type": "@id" },
    "Capability":  { "@id": "tori:Capability",  "@type": "@id" },
    "Skill":       { "@id": "tori:Skill",       "@type": "@id" },
    "Tool":        { "@id": "tori:Tool",        "@type": "@id" },
    "MCPTool":     { "@id": "tori:MCPTool",     "@type": "@id" },
    "BuiltinTool": { "@id": "tori:BuiltinTool", "@type": "@id" },
    "Task":        { "@id": "tori:Task",        "@type": "@id" },
    "AtomicTask":  { "@id": "tori:AtomicTask",  "@type": "@id" },
    "CompositeTask":{ "@id": "tori:CompositeTask","@type": "@id" },
    "Workflow":    { "@id": "tori:Workflow",    "@type": "@id" },
    "Stage":       { "@id": "tori:Stage",       "@type": "@id" },
    "Transition":  { "@id": "tori:Transition",  "@type": "@id" },
    "Artifact":    { "@id": "tori:Artifact",    "@type": "@id" },
    "FileArtifact":{ "@id": "tori:FileArtifact","@type": "@id" },
    "DocumentArtifact":{ "@id": "tori:DocumentArtifact","@type": "@id" },
    "DataArtifact":{ "@id": "tori:DataArtifact","@type": "@id" },
    "Knowledge":   { "@id": "tori:Knowledge",   "@type": "@id" },
    "SkillKnowledge":{ "@id": "tori:SkillKnowledge","@type": "@id" },
    "DomainKnowledge":{ "@id": "tori:DomainKnowledge","@type": "@id" },
    "Policy":      { "@id": "tori:Policy",      "@type": "@id" },
    "AllowPolicy": { "@id": "tori:AllowPolicy", "@type": "@id" },
    "DenyPolicy":  { "@id": "tori:DenyPolicy",  "@type": "@id" },

    "agentId":           { "@id": "tori:agentId",           "@type": "xsd:string" },
    "agentName":         { "@id": "tori:agentName",         "@type": "xsd:string" },
    "agentVersion":      { "@id": "tori:agentVersion",      "@type": "xsd:string" },
    "modelId":           { "@id": "tori:modelId",           "@type": "xsd:string" },
    "systemPrompt":      { "@id": "tori:systemPrompt",      "@type": "xsd:string" },
    "maxTokenBudget":    { "@id": "tori:maxTokenBudget",    "@type": "xsd:integer" },
    "maxToolCalls":      { "@id": "tori:maxToolCalls",      "@type": "xsd:integer" },
    "hasRole":           { "@id": "tori:hasRole",           "@type": "@id", "@container": "@set" },
    "hasTool":           { "@id": "tori:hasTool",           "@type": "@id", "@container": "@set" },
    "hasSkill":          { "@id": "tori:hasSkill",          "@type": "@id", "@container": "@set" },
    "canPerform":        { "@id": "tori:canPerform",        "@type": "@id", "@container": "@set" },
    "governedBy":        { "@id": "tori:governedBy",        "@type": "@id", "@container": "@set" },
    "participatesIn":    { "@id": "tori:participatesIn",    "@type": "@id", "@container": "@set" },
    "canExecute":        { "@id": "tori:canExecute",        "@type": "@id", "@container": "@set" },

    "roleId":            { "@id": "tori:roleId",            "@type": "xsd:string" },
    "roleName":          { "@id": "tori:roleName",          "@type": "xsd:string" },
    "roleDescription":   { "@id": "tori:roleDescription",   "@type": "xsd:string" },
    "roleScope":         { "@id": "tori:roleScope",         "@type": "xsd:string" },
    "grants":            { "@id": "tori:grants",            "@type": "@id", "@container": "@set" },
    "inheritsFrom":      { "@id": "tori:inheritsFrom",      "@type": "@id", "@container": "@set" },

    "capabilityId":      { "@id": "tori:capabilityId",      "@type": "xsd:string" },
    "capabilityName":    { "@id": "tori:capabilityName",    "@type": "xsd:string" },
    "capabilityCategory":{ "@id": "tori:capabilityCategory","@type": "xsd:string" },
    "capabilityDescription":{ "@id": "tori:capabilityDescription","@type": "xsd:string" },
    "implies":           { "@id": "tori:implies",           "@type": "@id", "@container": "@set" },

    "skillId":           { "@id": "tori:skillId",           "@type": "xsd:string" },
    "skillName":         { "@id": "tori:skillName",         "@type": "xsd:string" },
    "skillVersion":      { "@id": "tori:skillVersion",      "@type": "xsd:string" },
    "skillLocation":     { "@id": "tori:skillLocation",     "@type": "xsd:anyURI" },
    "skillDescription":  { "@id": "tori:skillDescription",  "@type": "xsd:string" },
    "skillTriggers":     { "@id": "tori:skillTriggers",     "@type": "xsd:string", "@container": "@set" },
    "enablesCapability": { "@id": "tori:enablesCapability", "@type": "@id", "@container": "@set" },
    "dependsOnSkill":    { "@id": "tori:dependsOnSkill",    "@type": "@id", "@container": "@set" },
    "applicableTo":      { "@id": "tori:applicableTo",      "@type": "@id", "@container": "@set" },

    "toolId":            { "@id": "tori:toolId",            "@type": "xsd:string" },
    "toolName":          { "@id": "tori:toolName",          "@type": "xsd:string" },
    "toolVersion":       { "@id": "tori:toolVersion",       "@type": "xsd:string" },
    "toolType":          { "@id": "tori:toolType",          "@type": "xsd:string" },
    "toolSchema":        { "@id": "tori:toolSchema",        "@type": "xsd:string" },
    "provides":          { "@id": "tori:provides",          "@type": "@id", "@container": "@set" },
    "requiresCapability":{ "@id": "tori:requiresCapability","@type": "@id", "@container": "@set" },
    "serverName":        { "@id": "tori:serverName",        "@type": "xsd:string" },

    "taskId":            { "@id": "tori:taskId",            "@type": "xsd:string" },
    "taskName":          { "@id": "tori:taskName",          "@type": "xsd:string" },
    "taskDescription":   { "@id": "tori:taskDescription",   "@type": "xsd:string" },
    "taskStatus":        { "@id": "tori:taskStatus",        "@type": "xsd:string" },
    "taskPriority":      { "@id": "tori:taskPriority",      "@type": "xsd:integer" },
    "requires":          { "@id": "tori:requires",          "@type": "@id", "@container": "@set" },
    "consumes":          { "@id": "tori:consumes",          "@type": "@id", "@container": "@set" },
    "produces":          { "@id": "tori:produces",          "@type": "@id", "@container": "@set" },
    "assignedTo":        { "@id": "tori:assignedTo",        "@type": "@id" },
    "dependsOn":         { "@id": "tori:dependsOn",         "@type": "@id", "@container": "@set" },
    "partOf":            { "@id": "tori:partOf",            "@type": "@id" },
    "hasSubTask":        { "@id": "tori:hasSubTask",        "@type": "@id", "@container": "@set" },

    "workflowId":        { "@id": "tori:workflowId",        "@type": "xsd:string" },
    "workflowName":      { "@id": "tori:workflowName",      "@type": "xsd:string" },
    "workflowVersion":   { "@id": "tori:workflowVersion",   "@type": "xsd:string" },
    "workflowStatus":    { "@id": "tori:workflowStatus",    "@type": "xsd:string" },
    "initialStage":      { "@id": "tori:initialStage",      "@type": "@id" },
    "terminalStage":     { "@id": "tori:terminalStage",     "@type": "@id", "@container": "@set" },
    "hasStage":          { "@id": "tori:hasStage",          "@type": "@id", "@container": "@set" },
    "hasTransition":     { "@id": "tori:hasTransition",     "@type": "@id", "@container": "@set" },
    "containsTask":      { "@id": "tori:containsTask",      "@type": "@id", "@container": "@set" },
    "executedBy":        { "@id": "tori:executedBy",        "@type": "@id", "@container": "@set" },

    "stageId":           { "@id": "tori:stageId",           "@type": "xsd:string" },
    "stageName":         { "@id": "tori:stageName",         "@type": "xsd:string" },
    "stageType":         { "@id": "tori:stageType",         "@type": "xsd:string" },
    "stageDescription":  { "@id": "tori:stageDescription",  "@type": "xsd:string" },
    "entryCondition":    { "@id": "tori:entryCondition",    "@type": "xsd:string" },
    "exitCondition":     { "@id": "tori:exitCondition",     "@type": "xsd:string" },
    "stageTask":         { "@id": "tori:stageTask",         "@type": "@id", "@container": "@set" },
    "outgoingTransition":{ "@id": "tori:outgoingTransition","@type": "@id", "@container": "@set" },
    "incomingTransition":{ "@id": "tori:incomingTransition","@type": "@id", "@container": "@set" },
    "belongsTo":         { "@id": "tori:belongsTo",         "@type": "@id" },

    "transitionId":      { "@id": "tori:transitionId",      "@type": "xsd:string" },
    "transitionName":    { "@id": "tori:transitionName",    "@type": "xsd:string" },
    "fromStage":         { "@id": "tori:fromStage",         "@type": "@id" },
    "toStage":           { "@id": "tori:toStage",           "@type": "@id" },
    "guardCondition":    { "@id": "tori:guardCondition",    "@type": "xsd:string" },
    "transitionPolicy":  { "@id": "tori:transitionPolicy",  "@type": "xsd:string" },
    "sideEffect":        { "@id": "tori:sideEffect",        "@type": "xsd:string" },
    "precondition":      { "@id": "tori:precondition",      "@type": "@id", "@container": "@set" },
    "postcondition":     { "@id": "tori:postcondition",     "@type": "@id", "@container": "@set" },

    "artifactId":        { "@id": "tori:artifactId",        "@type": "xsd:string" },
    "artifactName":      { "@id": "tori:artifactName",      "@type": "xsd:string" },
    "artifactType":      { "@id": "tori:artifactType",      "@type": "xsd:string" },
    "artifactStatus":    { "@id": "tori:artifactStatus",    "@type": "xsd:string" },
    "artifactLocation":  { "@id": "tori:artifactLocation",  "@type": "xsd:anyURI" },
    "artifactMimeType":  { "@id": "tori:artifactMimeType",  "@type": "xsd:string" },
    "artifactVersion":   { "@id": "tori:artifactVersion",   "@type": "xsd:string" },
    "artifactChecksum":  { "@id": "tori:artifactChecksum",  "@type": "xsd:string" },
    "producedBy":        { "@id": "tori:producedBy",        "@type": "@id" },
    "consumedBy":        { "@id": "tori:consumedBy",        "@type": "@id", "@container": "@set" },
    "derivedFrom":       { "@id": "tori:derivedFrom",       "@type": "@id", "@container": "@set" },
    "containsKnowledge": { "@id": "tori:containsKnowledge", "@type": "@id", "@container": "@set" },

    "knowledgeId":       { "@id": "tori:knowledgeId",       "@type": "xsd:string" },
    "knowledgeName":     { "@id": "tori:knowledgeName",     "@type": "xsd:string" },
    "knowledgeType":     { "@id": "tori:knowledgeType",     "@type": "xsd:string" },
    "knowledgeContent":  { "@id": "tori:knowledgeContent",  "@type": "xsd:string" },
    "knowledgeDomain":   { "@id": "tori:knowledgeDomain",   "@type": "xsd:string", "@container": "@set" },
    "knowledgeConfidence":{ "@id": "tori:knowledgeConfidence","@type": "xsd:decimal" },
    "sourceArtifact":    { "@id": "tori:sourceArtifact",    "@type": "@id", "@container": "@set" },
    "supersedes":        { "@id": "tori:supersedes",        "@type": "@id", "@container": "@set" },

    "policyId":          { "@id": "tori:policyId",          "@type": "xsd:string" },
    "policyName":        { "@id": "tori:policyName",        "@type": "xsd:string" },
    "policyType":        { "@id": "tori:policyType",        "@type": "xsd:string" },
    "policyPriority":    { "@id": "tori:policyPriority",    "@type": "xsd:integer" },
    "policyPattern":     { "@id": "tori:policyPattern",     "@type": "xsd:string", "@container": "@set" },
    "policyScope":       { "@id": "tori:policyScope",       "@type": "xsd:string" },
    "policyRationale":   { "@id": "tori:policyRationale",   "@type": "xsd:string" },
    "appliesToRole":     { "@id": "tori:appliesToRole",     "@type": "@id", "@container": "@set" },
    "restricts":         { "@id": "tori:restricts",         "@type": "@id", "@container": "@set" },
    "overrides":         { "@id": "tori:overrides",         "@type": "@id", "@container": "@set" }
  }
}
```

---

## 16. TypeScript Interface Contracts

These TypeScript interfaces are derived from the ontology and serve as the normative type contracts for the tori-agent runtime implementation. They are generated from the OWL class definitions and MUST remain in sync with the ontology.

```typescript
// ============================================================
// tori-agent Ontology — TypeScript Interface Contracts
// Generated from: spec-sc-01-ontology-schema.md v0.1.0
// DO NOT EDIT MANUALLY — regenerate from ontology source
// ============================================================

/** Ontology base IRI */
export const TORI_NS = "https://tori-agent.dev/ontology/2026/core#" as const;

/** Capability categories */
export type CapabilityCategory =
  | "filesystem"
  | "network"
  | "execution"
  | "knowledge"
  | "communication";

/** Tool types */
export type ToolType = "mcp" | "builtin" | "shell" | "api";

/** Task status values */
export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Workflow status values */
export type WorkflowStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "aborted";

/** Stage types */
export type StageType = "initial" | "intermediate" | "terminal";

/** Artifact status values */
export type ArtifactStatus = "pending" | "exists" | "stale" | "deleted";

/** Artifact types */
export type ArtifactType = "file" | "document" | "data" | "report";

/** Knowledge types */
export type KnowledgeType =
  | "fact"
  | "rule"
  | "heuristic"
  | "model"
  | "procedure";

/** Policy types */
export type PolicyType = "allow" | "deny";

/** Policy scopes */
export type PolicyScope =
  | "tool"
  | "path"
  | "command"
  | "network"
  | "workflow";

/** Role scopes */
export type RoleScope = "global" | "project" | "task";

/** Transition policy types */
export type TransitionPolicyType = "auto" | "manual" | "approval";

// ============================================================
// Core Interfaces
// ============================================================

export interface ToriAgent {
  "@type": "tori:Agent" | "tori:SpecialistAgent";
  "@id": string;
  agentId: string;
  agentName: string;
  agentVersion: string;
  modelId?: string;
  systemPrompt?: string;
  maxTokenBudget?: number;
  maxToolCalls?: number;
  hasRole: ToriRole[];
  hasTool?: ToriTool[];
  hasSkill?: ToriSkill[];
  /** Derived via axioms C1 and C2 — do not assert directly */
  canPerform?: ToriCapability[];
  governedBy?: ToriPolicy[];
  participatesIn?: ToriWorkflow[];
  /** Derived via axiom C3 — do not assert directly */
  canExecute?: ToriTask[];
}

export interface ToriRole {
  "@type": "tori:Role";
  "@id": string;
  roleId: string;
  roleName: string;
  roleDescription?: string;
  roleScope: RoleScope;
  grants: ToriCapability[];
  inheritsFrom?: ToriRole[];
}

export interface ToriCapability {
  "@type": "tori:Capability" | "tori:DerivedCapability";
  "@id": string;
  capabilityId: string;
  capabilityName: string;
  capabilityCategory: CapabilityCategory;
  capabilityDescription?: string;
  /** Weaker capabilities implied by this one (transitive) */
  implies?: ToriCapability[];
}

export interface ToriSkill {
  "@type": "tori:Skill";
  "@id": string;
  skillId: string;
  skillName: string;
  skillVersion: string;
  skillLocation: string;
  skillDescription?: string;
  skillTriggers?: string[];
  enablesCapability?: ToriCapability[];
  dependsOnSkill?: ToriSkill[];
  applicableTo?: ToriRole[];
}

export interface ToriTool {
  "@type": "tori:Tool" | "tori:MCPTool" | "tori:BuiltinTool";
  "@id": string;
  toolId: string;
  toolName: string;
  toolVersion?: string;
  toolType: ToolType;
  toolSchema?: string;
  provides: ToriCapability[];
  requiresCapability?: ToriCapability[];
  producesArtifact?: ToriArtifact[];
  consumesArtifact?: ToriArtifact[];
  /** MCP server name — MCPTool only */
  serverName?: string;
}

export interface ToriTask {
  "@type": "tori:Task" | "tori:AtomicTask" | "tori:CompositeTask";
  "@id": string;
  taskId: string;
  taskName: string;
  taskDescription?: string;
  taskStatus: TaskStatus;
  taskPriority?: number;
  requires?: ToriCapability[];
  consumes?: ToriArtifact[];
  produces?: ToriArtifact[];
  assignedTo?: ToriAgent;
  dependsOn?: ToriTask[];
  partOf?: ToriWorkflow;
  governedBy?: ToriPolicy[];
  /** CompositeTask only */
  hasSubTask?: ToriTask[];
}

export interface ToriWorkflow {
  "@type": "tori:Workflow";
  "@id": string;
  workflowId: string;
  workflowName: string;
  workflowVersion: string;
  workflowStatus: WorkflowStatus;
  initialStage: ToriStage;
  terminalStage: ToriStage[];
  hasStage: ToriStage[];
  hasTransition: ToriTransition[];
  containsTask?: ToriTask[];
  executedBy?: ToriAgent[];
  producesArtifact?: ToriArtifact[];
  governedBy?: ToriPolicy[];
}

export interface ToriStage {
  "@type": "tori:Stage";
  "@id": string;
  stageId: string;
  stageName: string;
  stageType: StageType;
  stageDescription?: string;
  entryCondition?: string;
  exitCondition?: string;
  stageTask?: ToriTask[];
  outgoingTransition?: ToriTransition[];
  incomingTransition?: ToriTransition[];
  belongsTo: ToriWorkflow;
}

export interface ToriTransition {
  "@type": "tori:Transition";
  "@id": string;
  transitionId: string;
  transitionName: string;
  fromStage: ToriStage;
  toStage: ToriStage;
  guardCondition?: string;
  transitionPolicy?: TransitionPolicyType;
  sideEffect?: string[];
  precondition?: ToriArtifact[];
  postcondition?: ToriArtifact[];
}

export interface ToriArtifact {
  "@type":
    | "tori:Artifact"
    | "tori:FileArtifact"
    | "tori:DocumentArtifact"
    | "tori:DataArtifact";
  "@id": string;
  artifactId: string;
  artifactName: string;
  artifactType: ArtifactType;
  artifactStatus: ArtifactStatus;
  artifactLocation?: string;
  artifactMimeType?: string;
  artifactVersion?: string;
  artifactChecksum?: string;
  producedBy?: ToriTask;
  consumedBy?: ToriTask[];
  derivedFrom?: ToriArtifact[];
  containsKnowledge?: ToriKnowledge[];
}

export interface ToriKnowledge {
  "@type": "tori:Knowledge" | "tori:SkillKnowledge" | "tori:DomainKnowledge";
  "@id": string;
  knowledgeId: string;
  knowledgeName: string;
  knowledgeType: KnowledgeType;
  knowledgeContent: string;
  knowledgeDomain?: string[];
  knowledgeConfidence?: number;
  sourceArtifact?: ToriArtifact[];
  appliesTo?: ToriRole[];
  supersedes?: ToriKnowledge[];
}

export interface ToriPolicy {
  "@type": "tori:Policy" | "tori:AllowPolicy" | "tori:DenyPolicy";
  "@id": string;
  policyId: string;
  policyName: string;
  policyType: PolicyType;
  policyPriority: number;
  policyPattern: string[];
  policyScope: PolicyScope;
  policyRationale?: string;
  appliesTo?: ToriAgent[];
  appliesToRole?: ToriRole[];
  restricts?: ToriCapability[];
  overrides?: ToriPolicy[];
}

// ============================================================
// Inference Result Types (runtime-only, not stored in ontology)
// ============================================================

/** Result of evaluating axiom C3 for a given Agent-Task pair */
export interface ExecutabilityResult {
  agent: string;
  task: string;
  canExecute: boolean;
  missingCapabilities: string[];
  blockedByArtifacts: string[];
}

/** Result of evaluating axiom C6 for a given Agent */
export interface EffectiveCapabilitySet {
  agent: string;
  declared: string[];
  roleGranted: string[];
  policyPermitted: string[];
  effective: string[];
  denied: string[];
}

/** Result of evaluating axiom C7 for a given Transition */
export interface TransitionValidityResult {
  transition: string;
  valid: boolean;
  guardSatisfied: boolean;
  missingPreconditions: string[];
  incompleteStageTaskIds: string[];
}
```

---

## 17. Conformance Checklist

Implementations claiming conformance with this specification MUST satisfy all items in this checklist. Items marked **[NORMATIVE]** are mandatory. Items marked **[RECOMMENDED]** are strongly advised but not strictly required.

### 17.1 Class Implementation

- [ ] **[NORMATIVE]** All 12 core classes (`Agent`, `Role`, `Capability`, `Skill`, `Tool`, `Task`, `Workflow`, `Stage`, `Transition`, `Artifact`, `Knowledge`, `Policy`) are implemented with all required properties.
- [ ] **[NORMATIVE]** All subclasses (`SpecialistAgent`, `MCPTool`, `BuiltinTool`, `AtomicTask`, `CompositeTask`, `FileArtifact`, `DocumentArtifact`, `DataArtifact`, `SkillKnowledge`, `DomainKnowledge`, `AllowPolicy`, `DenyPolicy`) are implemented.
- [ ] **[NORMATIVE]** All `exactly 1` cardinality constraints are enforced at instance creation time.
- [ ] **[NORMATIVE]** All `min N` cardinality constraints are enforced before workflow execution begins.
- [ ] **[RECOMMENDED]** Instances are serializable to valid JSON-LD using the normative `@context` from Section 15.

### 17.2 Axiom Enforcement

- [ ] **[NORMATIVE]** Axiom C1 (Capability Transitivity via Role) is implemented as a derived property. `canPerform` is never asserted directly; it is always inferred.
- [ ] **[NORMATIVE]** Axiom C2 (Tool-Capability Binding) is implemented. Tool availability contributes to the effective capability set.
- [ ] **[NORMATIVE]** Axiom C3 (Task Executability) is evaluated before any Task is dispatched. Tasks with missing capabilities are not dispatched.
- [ ] **[NORMATIVE]** Axiom C4 (Artifact Dependency) is enforced. Tasks with missing input artifacts are blocked.
- [ ] **[NORMATIVE]** Axiom C5 (Producer Completeness) is validated at Workflow load time. Orphan artifacts cause a validation error unless marked `externalArtifact`.
- [ ] **[NORMATIVE]** Axiom C6 (Permission Monotonicity) is enforced. DenyPolicy always reduces the effective capability set; it cannot be overridden by a lower-priority AllowPolicy.
- [ ] **[NORMATIVE]** Axiom C7 (Workflow Transition Validity) is enforced. Transitions are only fired when all three conditions (guard, preconditions, stage task completion) are satisfied.

### 17.3 Policy Evaluation

- [ ] **[NORMATIVE]** Policies are evaluated in descending priority order (highest `policyPriority` first).
- [ ] **[NORMATIVE]** DenyPolicy takes precedence over AllowPolicy at equal priority.
- [ ] **[NORMATIVE]** Policy patterns are matched using glob semantics for `"path"` and `"command"` scopes.
- [ ] **[RECOMMENDED]** Policy evaluation results are logged with the matching policy ID and pattern for auditability.

### 17.4 Artifact Lifecycle

- [ ] **[NORMATIVE]** Artifact status transitions follow: `pending` → `exists` → `stale` | `deleted`.
- [ ] **[NORMATIVE]** An Artifact's status is set to `exists` only after the producing Task completes successfully.
- [ ] **[NORMATIVE]** An Artifact's checksum (`artifactChecksum`) is computed and stored when status transitions to `exists`.
- [ ] **[RECOMMENDED]** Artifact provenance chains (`derivedFrom`) are maintained and queryable.

### 17.5 Workflow State Machine

- [ ] **[NORMATIVE]** Every Workflow has exactly one `initialStage` and at least one `terminalStage`.
- [ ] **[NORMATIVE]** The Workflow state machine is acyclic (no cycles in the Stage-Transition graph), except for correction loops explicitly modeled as separate Stages.
- [ ] **[NORMATIVE]** Stage entry and exit conditions are evaluated as boolean expressions. Malformed expressions cause a validation error, not a silent pass.
- [ ] **[RECOMMENDED]** Workflow execution history (stage transitions with timestamps) is persisted for audit.

### 17.6 JSON-LD Compliance

- [ ] **[NORMATIVE]** All serialized instances use the normative `@context` IRI `https://tori-agent.dev/ontology/2026/core/context.jsonld` or inline the normative context from Section 15.
- [ ] **[NORMATIVE]** All `@id` values use the `toria:` namespace prefix for instance IRIs.
- [ ] **[NORMATIVE]** No term defined in the normative context is redefined in a local context extension.
- [ ] **[RECOMMENDED]** Instances are validated against the SHACL shapes defined in Spec-SC-02 before being stored.

### 17.7 TypeScript Contracts

- [ ] **[NORMATIVE]** Runtime implementations in TypeScript use the interfaces from Section 16 as the type contracts.
- [ ] **[NORMATIVE]** The `canPerform` and `canExecute` fields on `ToriAgent` are populated only by the inference engine, never by direct assignment in application code.
- [ ] **[RECOMMENDED]** A code generator is used to keep TypeScript interfaces in sync with the OWL class definitions. Manual edits to generated interfaces are prohibited.

---

## 18. Related Specifications

| Spec ID | Title | Status | Relationship |
|---------|-------|--------|-------------|
| SC-02 | SHACL Shapes for Ontology Validation | draft | Normative companion — defines SHACL shapes for all 12 classes |
| SC-03 | Datalog Policy Engine | draft | Normative companion — implements axioms C1–C7 in Soufflé Datalog |
| SC-04 | JSON-LD Context & Serialization | draft | Normative companion — full context file and serialization rules |
| SC-05 | Ontology Registry & Versioning | draft | Informative — describes how ontology versions are managed |

---

## 19. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2026-09-06 | tori-agent ontology team | Initial draft — 12 core classes, 7 axioms, full JSON-LD context, TypeScript contracts |

---

*End of Spec-SC-01. This document is normative. All implementations of the tori-agent Ontological Upgrade MUST conform to the definitions herein.*
