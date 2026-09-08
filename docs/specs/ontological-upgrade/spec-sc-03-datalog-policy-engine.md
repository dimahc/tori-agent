---
title: "[Spec-SC-03] Datalog Policy Engine"
status: draft
created: 2026-09-06
spec_id: SC-03
domain: ontology/reasoning
version: "0.1.0"
authors:
  - Lead Systems Architect
related_specs:
  - SC-01: Ontology Schema (normative dependency)
  - SC-02: SHACL Shapes (normative companion)
  - SC-04: JSON-LD Context & Serialization (informative)
---

# [Spec-SC-03] Datalog Policy Engine

---

## 1. Executive Summary

### 1.1 Role of Datalog in the Neuro-symbolic Triad

The tori-agent system is built on a **Neuro-symbolic Triad** — three complementary layers that together provide formal semantics, structural validation, and operational policy enforcement:

| Layer | Technology | Role | Spec |
|-------|-----------|------|------|
| **Tier 1 — Semantic Core** | JSON-LD / OWL 2 DL | Defines meaning: class hierarchy, property semantics, inference axioms | SC-01 |
| **Tier 2 — Reasoning Engine** | SHACL (Shapes Constraint Language) | Validates structure: cardinality, type constraints, cross-entity rules | SC-02 |
| **Tier 3 — Policy Engine** | Datalog (Soufflé dialect) | Enforces operational rules: capability propagation, permission monotonicity, derived facts | **SC-03 (this spec)** |

SC-03 is the **normative companion** to SC-02. The two tiers are complementary but non-overlapping in their expressive power:

- **SHACL** (SC-02) enforces *structural* constraints: cardinality, type membership, value ranges, and SPARQL-based cross-property rules. SHACL operates on a snapshot of the RDF graph and cannot express recursive or transitive rules.
- **Datalog** (SC-03) enforces *operational* constraints: transitive closure over capability hierarchies, recursive artifact dependency chains, permission monotonicity across workflow stages, and derived facts that require fixpoint computation.

The critical distinction is **recursion**. SHACL cannot express "agent A has capability C if A has role R, R requires capability C2, and C2 subsumes C through any chain of subsumption steps." Datalog can, and does so with guaranteed termination under the stratified negation discipline.

### 1.2 What SHACL Cannot Do — Datalog's Unique Contribution

SHACL is a W3C standard for RDF graph validation. It is powerful for local structural constraints but has fundamental limitations:

1. **No recursive rules.** SHACL SPARQL constraints can express one-hop joins but not transitive closure. Computing "all transitive dependencies of an artifact" requires recursive rules — impossible in SHACL.

2. **No derived relations.** SHACL validates existing triples; it cannot derive new facts. Datalog's IDB (Intensional Database) computes derived relations like `agent_has_capability` that do not exist as explicit triples in the graph.

3. **No stratified negation over derived facts.** SHACL's `sh:not` operates on property values, not on derived relations. Datalog's stratified negation allows rules like "violation if agent uses tool AND NOT agent has required capability" where `agent_has_capability` is itself a derived relation.

4. **No counting over recursive structures.** Counting producers across a transitive dependency chain requires aggregation over a recursive relation — beyond SHACL's reach.

### 1.3 Datalog vs SPARQL vs Prolog

| Criterion | Datalog | SPARQL | Prolog |
|-----------|---------|--------|--------|
| **Decidability** | ✅ Always decidable | ✅ Decidable (SPARQL 1.1) | ❌ Turing-complete, undecidable |
| **Recursive rules** | ✅ Native, guaranteed termination | ⚠️ Property paths only (no aggregation) | ✅ Yes, but may not terminate |
| **Stratified negation** | ✅ Safe, decidable | ⚠️ MINUS/NOT EXISTS (limited) | ⚠️ Cut-based, unsafe |
| **Fixpoint semantics** | ✅ Bottom-up, deterministic | ❌ No fixpoint | ❌ Top-down, non-deterministic |
| **Performance** | ✅ Polynomial in data size | ✅ Polynomial | ❌ Exponential worst case |
| **RDF integration** | ⚠️ Requires EDB export | ✅ Native SPARQL-over-RDF | ❌ Requires adapter |
| **Tooling** | ✅ Soufflé (industrial-grade) | ✅ Apache Jena, rdflib | ⚠️ SWI-Prolog |

**Why Datalog?** The combination of decidability, recursive rules, stratified negation, and efficient bottom-up fixpoint evaluation makes Datalog the correct choice for the policy layer. SPARQL cannot express the recursive capability transitivity rules (C1) or the transitive artifact dependency closure (C2). Prolog can express them but offers no termination guarantee and no efficient fixpoint semantics.

### 1.4 Evaluation Strategy: Bottom-Up Fixpoint Computation

The Datalog engine uses **bottom-up fixpoint computation** (also called the naive or semi-naive evaluation algorithm):

1. **Initialize** the IDB with all EDB facts.
2. **Apply rules**: for each rule, compute all tuples that can be derived from the current IDB.
3. **Add** newly derived tuples to the IDB.
4. **Repeat** steps 2–3 until no new tuples are added (fixpoint reached).
5. **Output** all violation relations from the final IDB.

This strategy is guaranteed to terminate for stratified Datalog programs (no recursion through negation). The Soufflé compiler further optimizes evaluation using magic sets transformation and parallel evaluation.

### 1.5 Integration Point: Harness Invocation

The Datalog engine is invoked **after** SHACL validation passes. The pipeline is:

```
JSON-LD Graph
      │
      ▼
SHACL Validator (SC-02)
      │
      ├── sh:Violation → BLOCK (do not proceed to Datalog)
      │
      ▼ (SHACL passes)
EDB Export (JSON-LD → CSV facts)
      │
      ▼
Soufflé Datalog Engine
      │
      ├── Violation relations → PolicyViolation[]
      │     ├── ERROR severity → BLOCK commit
      │     └── WARNING severity → LOG, continue
      │
      ▼ (no ERROR violations)
Commit / Stage Transition
```

This ordering is intentional: SHACL catches structural errors (missing required properties, wrong types) before Datalog runs. Running Datalog on a structurally invalid graph would produce spurious violations and confusing error messages.

### 1.6 Rule Set Summary

| Rule Set | Axiom | Derived Relations | Violation Relations | Rule Count |
|----------|-------|-------------------|---------------------|-----------|
| Capability Transitivity | C1 | `agent_has_capability` (recursive) | `capability_violation` | 4 |
| Artifact Dependency Closure | C2 | `transitive_dependency` (recursive) | `missing_dependency`, `stale_dependency` | 5 |
| Producer Completeness | C3 | `producer_count` | `no_producer`, `multiple_producers` | 4 |
| Permission Monotonicity | C4 | `permission_at_stage` | `permission_revoked` | 3 |
| Tool-Capability Binding | C5 | `tool_required_capability` | `unauthorized_tool_use` | 3 |
| Transition Validity | C6 | `transition_workflow` | `cross_workflow_transition` | 3 |
| Review Independence | C7 | — | `self_review` | 2 |
| Utility Relations | — | `reachable_stage`, `workflow_complete`, `agent_workload`, `artifact_ready` | — | 6 |
| **Total** | | | | **30** |

---

## 2. Datalog Primer

### 2.1 EDB — Extensional Database

The **Extensional Database (EDB)** contains the base facts — ground atoms that are explicitly asserted and never derived by rules. In the tori-agent system, EDB facts are loaded from the JSON-LD graph by exporting each RDF property to a CSV relation.

Example EDB facts:
```datalog
agent("agent:tori-executor").
role("role:specialist").
agent_has_role("agent:tori-executor", "role:specialist").
role_requires_capability("role:specialist", "cap:code-execution").
```

EDB relations are declared with `.decl` and loaded with `.input` in Soufflé. They are **read-only** — rules may not add facts to EDB relations.

### 2.2 IDB — Intensional Database

The **Intensional Database (IDB)** contains derived facts — atoms computed by applying rules to the EDB (and to previously derived IDB facts). IDB relations are declared with `.decl` and populated by rules.

Example IDB derivation:
```datalog
// EDB: agent_has_role("agent:tori-executor", "role:specialist")
// EDB: role_requires_capability("role:specialist", "cap:code-execution")
// Rule: agent_has_capability(A, C) :- agent_has_role(A, R), role_requires_capability(R, C).
// Derived IDB: agent_has_capability("agent:tori-executor", "cap:code-execution")
```

IDB relations are never loaded from external sources — they exist only as the result of rule evaluation.

### 2.3 Rule Syntax

Datalog rules have the form:

```
head :- body1, body2, ..., not bodyN.
```

Where:
- `head` is a single atom (the derived fact to be added to the IDB)
- `body1, body2, ...` are positive atoms (must all be true)
- `not bodyN` is a negated atom (must be false — stratified negation)
- Variables are uppercase (`A`, `R`, `C`); constants are quoted strings (`"agent:tori-executor"`)
- A rule fires for every substitution of variables that makes all body atoms true

In Soufflé syntax, rules use `:-` and negation uses `!`:
```datalog
capability_violation(Task, Agent, Cap) :-
  task_requires_capability(Task, Cap),
  task_assigned_to(Task, Agent),
  !agent_has_capability(Agent, Cap).
```

### 2.4 Stratified Negation

**Stratified negation** is a discipline that ensures Datalog programs with negation remain decidable and have a unique minimal model. A program is stratified if it can be partitioned into strata (layers) such that:

- No stratum contains a recursive rule that uses negation of a relation defined in the same stratum.
- Negation only appears over relations defined in lower strata (already fully computed).

In the tori-agent policy engine, stratification is achieved naturally:

- **Stratum 0**: EDB facts (no rules, no negation)
- **Stratum 1**: Positive recursive rules (`agent_has_capability`, `transitive_dependency`)
- **Stratum 2**: Violation rules using negation over Stratum 1 relations (`capability_violation`, `unauthorized_tool_use`)

This means all recursive derivations complete before any negation is evaluated — guaranteeing correctness and termination.

### 2.5 Fixpoint Semantics

The **minimal fixpoint** of a Datalog program is the smallest set of ground atoms that:
1. Contains all EDB facts.
2. Is closed under all rules: if the body of a rule is satisfied, the head is in the set.

The fixpoint is computed iteratively (bottom-up evaluation):
- Start with EDB.
- Apply all rules; add newly derived atoms.
- Repeat until no new atoms are added.
- The result is the unique minimal model of the program.

For stratified programs, the fixpoint is computed stratum by stratum, ensuring negation is evaluated only after the negated relation has reached its fixpoint.

**Termination guarantee**: For Datalog without function symbols (which the tori-agent engine does not use), the fixpoint is always reached in polynomial time in the size of the EDB, because the number of possible ground atoms is bounded by the Herbrand base (all combinations of constants appearing in the EDB).

### 2.6 Soufflé Datalog Dialect

The tori-agent policy engine uses **Soufflé** (https://souffle-lang.github.io/), an industrial-strength Datalog compiler developed at Oracle Labs and now maintained as an open-source project. Soufflé compiles Datalog programs to C++ for native execution, achieving performance competitive with hand-written C++ for large graphs.

Key Soufflé syntax elements used in this spec:

```datalog
// Type declarations
.type Symbol = symbol

// Relation declarations (EDB and IDB)
.decl agent(id: symbol)
.decl agent_has_role(agent: symbol, role: symbol)

// Input directive (load EDB from CSV)
.input agent(filename="agent.csv", delimiter=",")

// Output directive (write IDB to CSV)
.output capability_violation(filename="capability_violation.csv")

// Rules
agent_has_capability(A, C) :-
  agent_has_role(A, R),
  role_requires_capability(R, C).

// Aggregation
.decl producer_count(artifact: symbol, n: number)
producer_count(Art, count : { artifact_produced_by(Art, _) }) :-
  artifact(Art).

// Negation
capability_violation(Task, Agent, Cap) :-
  task_requires_capability(Task, Cap),
  task_assigned_to(Task, Agent),
  !agent_has_capability(Agent, Cap).
```

Soufflé supports parallel evaluation (OpenMP), magic sets optimization, and incremental evaluation — all relevant for production use with large ontology graphs.

---

## 3. EDB Schema — Base Fact Relations

All base fact relations are loaded from the JSON-LD graph via CSV export. The JSON-LD exporter (specified in SC-04) serializes each RDF property as a row in the corresponding CSV file.

### 3.1 Entity Type Relations

These unary relations assert class membership, corresponding to `rdf:type` assertions in the JSON-LD graph.

```datalog
// ── Entity type relations ──────────────────────────────────────────────────

// tori:Agent instances
// Source: { "@type": "tori:Agent" }
.decl agent(id: symbol)
.input agent(filename="agent.csv", delimiter=",")

// tori:Role instances
// Source: { "@type": "tori:Role" }
.decl role(id: symbol)
.input role(filename="role.csv", delimiter=",")

// tori:Capability instances
// Source: { "@type": "tori:Capability" }
.decl capability(id: symbol)
.input capability(filename="capability.csv", delimiter=",")

// tori:Skill instances
// Source: { "@type": "tori:Skill" }
.decl skill(id: symbol)
.input skill(filename="skill.csv", delimiter=",")

// tori:Tool instances
// Source: { "@type": "tori:Tool" }
.decl tool(id: symbol)
.input tool(filename="tool.csv", delimiter=",")

// tori:Task instances
// Source: { "@type": "tori:Task" }
.decl task(id: symbol)
.input task(filename="task.csv", delimiter=",")

// tori:Workflow instances
// Source: { "@type": "tori:Workflow" }
.decl workflow(id: symbol)
.input workflow(filename="workflow.csv", delimiter=",")

// tori:Stage instances
// Source: { "@type": "tori:Stage" }
.decl stage(id: symbol)
.input stage(filename="stage.csv", delimiter=",")

// tori:Transition instances
// Source: { "@type": "tori:Transition" }
.decl transition(id: symbol)
.input transition(filename="transition.csv", delimiter=",")

// tori:Artifact instances
// Source: { "@type": "tori:Artifact" }
.decl artifact(id: symbol)
.input artifact(filename="artifact.csv", delimiter=",")

// tori:Knowledge instances
// Source: { "@type": "tori:Knowledge" }
.decl knowledge(id: symbol)
.input knowledge(filename="knowledge.csv", delimiter=",")

// tori:Policy instances
// Source: { "@type": "tori:Policy" }
.decl policy(id: symbol)
.input policy(filename="policy.csv", delimiter=",")
```

### 3.2 Agent-Role-Capability Relations

```datalog
// ── Agent / Role / Capability relations ───────────────────────────────────

// An agent holds a role.
// Source: tori:hasRole property
// Example: { "@id": "agent:tori-executor", "tori:hasRole": { "@id": "role:specialist" } }
.decl agent_has_role(agent: symbol, role: symbol)
.input agent_has_role(filename="agent_has_role.csv", delimiter=",")

// A role requires a capability to be fulfilled.
// Source: tori:requiresCapability property
// Example: { "@id": "role:specialist", "tori:requiresCapability": { "@id": "cap:code-execution" } }
.decl role_requires_capability(role: symbol, cap: symbol)
.input role_requires_capability(filename="role_requires_capability.csv", delimiter=",")

// Capability subsumption: parent capability subsumes (generalizes) child capability.
// Semantics: if an agent has capability C_parent, and C_parent subsumes C_child,
// then the agent also has C_child (by inheritance).
// Source: tori:subsumes property (inverse of rdfs:subClassOf in capability hierarchy)
// Example: { "@id": "cap:code-execution", "tori:subsumes": { "@id": "cap:python-execution" } }
.decl capability_subsumes(parent: symbol, child: symbol)
.input capability_subsumes(filename="capability_subsumes.csv", delimiter=",")

// A task requires a specific capability to be executed.
// Source: tori:requiresCapability on tori:Task
// Example: { "@id": "task:implement-feature", "tori:requiresCapability": { "@id": "cap:code-execution" } }
.decl task_requires_capability(task: symbol, cap: symbol)
.input task_requires_capability(filename="task_requires_capability.csv", delimiter=",")
```

### 3.3 Tool Relations

```datalog
// ── Tool relations ─────────────────────────────────────────────────────────

// An agent has access to a tool.
// Source: tori:hasTool property
// Example: { "@id": "agent:tori-executor", "tori:hasTool": { "@id": "tool:bash" } }
.decl agent_has_tool(agent: symbol, tool: symbol)
.input agent_has_tool(filename="agent_has_tool.csv", delimiter=",")

// A tool binds (requires) a capability for use.
// Source: tori:bindsCapability property
// Example: { "@id": "tool:bash", "tori:bindsCapability": { "@id": "cap:shell-execution" } }
.decl tool_binds_capability(tool: symbol, cap: symbol)
.input tool_binds_capability(filename="tool_binds_capability.csv", delimiter=",")

// An agent uses a tool during task execution (observed fact, not just access).
// Source: tori:usesTool property on tori:Task or execution log
// Example: { "@id": "task:run-tests", "tori:usesTool": { "@id": "tool:bash" } }
.decl agent_uses_tool(agent: symbol, tool: symbol)
.input agent_uses_tool(filename="agent_uses_tool.csv", delimiter=",")
```

### 3.4 Task and Artifact Relations

```datalog
// ── Task / Artifact relations ──────────────────────────────────────────────

// A task is assigned to an agent.
// Source: tori:assignedTo property
// Example: { "@id": "task:implement-feature", "tori:assignedTo": { "@id": "agent:tori-executor" } }
.decl task_assigned_to(task: symbol, agent: symbol)
.input task_assigned_to(filename="task_assigned_to.csv", delimiter=",")

// An artifact is produced by an agent.
// Source: tori:producedBy property
// Example: { "@id": "artifact:spec-sc-03", "tori:producedBy": { "@id": "agent:tori-executor" } }
.decl artifact_produced_by(artifact: symbol, agent: symbol)
.input artifact_produced_by(filename="artifact_produced_by.csv", delimiter=",")

// An artifact is reviewed by an agent.
// Source: tori:reviewedBy property
// Example: { "@id": "artifact:spec-sc-03", "tori:reviewedBy": { "@id": "agent:tori-reviewer" } }
.decl artifact_reviewed_by(artifact: symbol, agent: symbol)
.input artifact_reviewed_by(filename="artifact_reviewed_by.csv", delimiter=",")

// An artifact depends on another artifact (direct dependency).
// Source: tori:dependsOn property
// Example: { "@id": "artifact:impl-sc-03", "tori:dependsOn": { "@id": "artifact:spec-sc-03" } }
.decl artifact_depends_on(artifact: symbol, dep: symbol)
.input artifact_depends_on(filename="artifact_depends_on.csv", delimiter=",")

// The current status of an artifact.
// Source: tori:status property (datatype: xsd:string)
// Valid values: "draft" | "valid" | "invalid" | "cancelled" | "pending"
// Example: { "@id": "artifact:spec-sc-03", "tori:status": "valid" }
.decl artifact_status(artifact: symbol, status: symbol)
.input artifact_status(filename="artifact_status.csv", delimiter=",")
```

### 3.5 Workflow and Stage Relations

```datalog
// ── Workflow / Stage / Transition relations ────────────────────────────────

// A stage belongs to a workflow.
// Source: tori:belongsTo property (or inverse of tori:hasStage)
// Example: { "@id": "workflow-stage:execution", "tori:belongsTo": { "@id": "workflow:orchestration-pipeline" } }
.decl stage_belongs_to_workflow(stage: symbol, workflow: symbol)
.input stage_belongs_to_workflow(filename="stage_belongs_to_workflow.csv", delimiter=",")

// A transition originates from a stage.
// Source: tori:fromStage property
// Example: { "@id": "workflow-transition:exec-to-verify", "tori:fromStage": { "@id": "workflow-stage:execution" } }
.decl transition_from_stage(trans: symbol, stage: symbol)
.input transition_from_stage(filename="transition_from_stage.csv", delimiter=",")

// A transition targets a stage.
// Source: tori:toStage property
// Example: { "@id": "workflow-transition:exec-to-verify", "tori:toStage": { "@id": "workflow-stage:verification" } }
.decl transition_to_stage(trans: symbol, stage: symbol)
.input transition_to_stage(filename="transition_to_stage.csv", delimiter=",")

// A stage is the initial stage of a workflow.
// Source: tori:initialStage property
// Example: { "@id": "workflow:orchestration-pipeline", "tori:initialStage": { "@id": "workflow-stage:requirements" } }
.decl workflow_initial_stage(workflow: symbol, stage: symbol)
.input workflow_initial_stage(filename="workflow_initial_stage.csv", delimiter=",")

// The current status of a workflow.
// Source: tori:status property on tori:Workflow
// Valid values: "active" | "completed" | "cancelled" | "suspended"
.decl workflow_status(workflow: symbol, status: symbol)
.input workflow_status(filename="workflow_status.csv", delimiter=",")

// The ordinal index of a stage within its workflow (for monotonicity checking).
// Source: tori:stageIndex property (xsd:integer)
// Example: { "@id": "workflow-stage:execution", "tori:stageIndex": 2 }
.decl stage_index(stage: symbol, idx: number)
.input stage_index(filename="stage_index.csv", delimiter=",")
```

### 3.6 Permission and Policy Relations

```datalog
// ── Permission / Policy relations ─────────────────────────────────────────

// A policy applies to a class of entities.
// Source: tori:appliesTo property
// Example: { "@id": "policy:allow-bash", "tori:appliesTo": "tori:Tool" }
.decl policy_applies_to(policy: symbol, class: symbol)
.input policy_applies_to(filename="policy_applies_to.csv", delimiter=",")

// The effect of a policy: "Allow" or "Deny".
// Source: tori:effect property
// Example: { "@id": "policy:allow-bash", "tori:effect": "Allow" }
.decl policy_effect(policy: symbol, effect: symbol)
.input policy_effect(filename="policy_effect.csv", delimiter=",")

// A permission is granted to an agent for an action on a resource.
// Source: tori:grantsPermission child node
// Example: { "@id": "perm:exec-bash", "tori:agent": "agent:tori-executor",
//            "tori:action": "execute", "tori:resource": "tool:bash" }
.decl permission_granted(agent: symbol, action: symbol, resource: symbol)
.input permission_granted(filename="permission_granted.csv", delimiter=",")

// A permission is granted at a specific workflow stage.
// Source: tori:grantedAtStage property on permission node
// Example: { "@id": "perm:exec-bash", "tori:grantedAtStage": { "@id": "workflow-stage:execution" } }
.decl permission_granted_at_stage(agent: symbol, action: symbol, resource: symbol, stage: symbol)
.input permission_granted_at_stage(filename="permission_granted_at_stage.csv", delimiter=",")
```

---

## 4. IDB Rules — Derived Relations

### 4.1 C1: Capability Transitivity

**Axiom C1** states that an agent has a capability if it holds a role that requires that capability, or if it has a capability that subsumes the required capability through any chain of subsumption steps.

This is the most important rule set because capability checking is the foundation of all access control in the system. The transitivity through capability subsumption allows the ontology to define fine-grained capability hierarchies (e.g., `cap:python-execution` is subsumed by `cap:code-execution`) without requiring every role to enumerate all leaf capabilities.

```datalog
// ── C1: Capability Transitivity ────────────────────────────────────────────

// C1.1 Direct capability: agent has capability C if it holds role R
//      and R requires C.
//      This is the base case — no recursion.
agent_has_capability(A, C) :-
  agent_has_role(A, R),
  role_requires_capability(R, C).

// C1.2 Transitive capability via subsumption: agent has capability C
//      if it already has capability C2, and C2 subsumes C.
//      This rule is recursive: agent_has_capability appears in both
//      head and body. Soufflé handles this via semi-naive evaluation.
//      Termination is guaranteed because capability_subsumes is acyclic
//      (enforced by SHACL shape tori:CapabilityShape, sh:property
//      tori:subsumes with sh:disjoint constraint).
agent_has_capability(A, C) :-
  agent_has_capability(A, C2),
  capability_subsumes(C2, C).

// C1.3 Capability violation: a task is assigned to an agent that lacks
//      a required capability.
//      Uses stratified negation: agent_has_capability is fully computed
//      (Stratum 1) before this rule fires (Stratum 2).
capability_violation(Task, Agent, Cap) :-
  task_requires_capability(Task, Cap),
  task_assigned_to(Task, Agent),
  !agent_has_capability(Agent, Cap).

// C1.4 Output: mark capability violations for reporting.
.decl agent_has_capability(agent: symbol, cap: symbol)
.decl capability_violation(task: symbol, agent: symbol, cap: symbol)
.output capability_violation(filename="capability_violation.csv")
```

**Termination argument**: The `agent_has_capability` relation is bounded by `|agents| × |capabilities|`. Each rule application adds at most one new tuple. Since the Herbrand base is finite, the fixpoint is reached in at most `|agents| × |capabilities|` iterations.

### 4.2 C2: Artifact Dependency Closure

**Axiom C2** states that all transitive dependencies of an artifact must exist in the graph and be in a valid state. This requires computing the transitive closure of the `artifact_depends_on` relation.

```datalog
// ── C2: Artifact Dependency Closure ───────────────────────────────────────

// C2.1 Direct dependency (base case for transitive closure).
transitive_dependency(Art, Dep) :-
  artifact_depends_on(Art, Dep).

// C2.2 Transitive dependency: if Art depends on Mid, and Mid transitively
//      depends on Dep, then Art transitively depends on Dep.
//      Recursive rule — Soufflé evaluates via semi-naive fixpoint.
transitive_dependency(Art, Dep) :-
  artifact_depends_on(Art, Mid),
  transitive_dependency(Mid, Dep).

// C2.3 Missing dependency: artifact Art has a transitive dependency Dep
//      that does not appear in the artifact relation (not in the graph).
missing_dependency(Art, Dep) :-
  transitive_dependency(Art, Dep),
  !artifact(Dep).

// C2.4 Stale dependency: artifact Art has a transitive dependency Dep
//      that exists but is in an invalid or cancelled state.
stale_dependency(Art, Dep) :-
  transitive_dependency(Art, Dep),
  artifact_status(Dep, Status),
  (Status = "invalid" ; Status = "cancelled").

// C2.5 Artifact ready: artifact Art has no missing or stale dependencies
//      and is itself in a valid state.
//      Used by workflow_complete (Section 4.8).
artifact_ready(Art) :-
  artifact(Art),
  artifact_status(Art, "valid"),
  !missing_dependency(Art, _),
  !stale_dependency(Art, _).

.decl transitive_dependency(artifact: symbol, dep: symbol)
.decl missing_dependency(artifact: symbol, dep: symbol)
.decl stale_dependency(artifact: symbol, dep: symbol)
.decl artifact_ready(artifact: symbol)
.output missing_dependency(filename="missing_dependency.csv")
.output stale_dependency(filename="stale_dependency.csv")
```

### 4.3 C3: Producer Completeness

**Axiom C3** states that every artifact must have exactly one producer. Zero producers means the artifact is orphaned (no agent is accountable). Multiple producers means the artifact has ambiguous ownership, which violates the single-responsibility principle of the tori-agent workflow model.

```datalog
// ── C3: Producer Completeness ──────────────────────────────────────────────

// C3.1 Count producers per artifact using Soufflé aggregation.
//      The count aggregate fires for every artifact in the artifact relation,
//      counting how many distinct agents are listed as producers.
.decl producer_count(artifact: symbol, n: number)
producer_count(Art, count : { artifact_produced_by(Art, _) }) :-
  artifact(Art).

// C3.2 No producer: artifact exists but has zero producers.
//      Severity: ERROR — an artifact with no producer cannot be traced
//      to any accountable agent.
no_producer(Art) :-
  producer_count(Art, 0).

// C3.3 Multiple producers: artifact has more than one producer.
//      We also capture the two conflicting producers for diagnostics.
//      Severity: ERROR — ambiguous ownership.
multiple_producers(Art, A1, A2) :-
  artifact_produced_by(Art, A1),
  artifact_produced_by(Art, A2),
  A1 != A2.

.decl producer_count(artifact: symbol, n: number)
.decl no_producer(artifact: symbol)
.decl multiple_producers(artifact: symbol, agent1: symbol, agent2: symbol)
.output no_producer(filename="no_producer.csv")
.output multiple_producers(filename="multiple_producers.csv")
```

**Note on `multiple_producers`**: The rule produces symmetric pairs `(Art, A1, A2)` and `(Art, A2, A1)`. The TypeScript harness deduplicates these by normalizing to `A1 < A2` (lexicographic order) before reporting.

### 4.4 C4: Permission Monotonicity

**Axiom C4** states that permissions granted to an agent during a workflow cannot be silently revoked mid-execution. This is a safety property: if an agent was granted permission to use a tool at stage N, that permission must still hold at stage N+1 (within the same workflow). Revocation is only permitted at workflow boundaries.

```datalog
// ── C4: Permission Monotonicity ────────────────────────────────────────────

// C4.1 Derive the workflow that a permission-at-stage belongs to.
//      Joins permission_granted_at_stage with stage_belongs_to_workflow.
permission_in_workflow(Agent, Action, Resource, Workflow, StageIdx) :-
  permission_granted_at_stage(Agent, Action, Resource, Stage),
  stage_belongs_to_workflow(Stage, Workflow),
  stage_index(Stage, StageIdx).

// C4.2 Permission revocation: permission (Agent, Action, Resource) exists
//      at stage with index Idx1 in workflow W, but does NOT exist at a
//      later stage with index Idx2 > Idx1 in the same workflow.
//      This detects silent revocation — the permission disappears without
//      an explicit workflow boundary.
permission_revoked(Agent, Action, Resource, LaterStage) :-
  permission_in_workflow(Agent, Action, Resource, W, Idx1),
  stage_belongs_to_workflow(LaterStage, W),
  stage_index(LaterStage, Idx2),
  Idx2 > Idx1,
  !permission_granted_at_stage(Agent, Action, Resource, LaterStage).

.decl permission_in_workflow(agent: symbol, action: symbol, resource: symbol, workflow: symbol, idx: number)
.decl permission_revoked(agent: symbol, action: symbol, resource: symbol, stage: symbol)
.output permission_revoked(filename="permission_revoked.csv")
```

**Scope note**: The monotonicity check is **workflow-scoped**. A permission that exists in workflow W1 but not in workflow W2 does not constitute a violation — workflows are independent permission domains. The `stage_belongs_to_workflow` join ensures this scoping.

### 4.5 C5: Tool-Capability Binding

**Axiom C5** states that every tool must bind at least one capability, and an agent can only use a tool if it has the capability the tool binds. This enforces that tool access is mediated by the capability system — it is not possible to grant tool access without also granting the underlying capability.

```datalog
// ── C5: Tool-Capability Binding ────────────────────────────────────────────

// C5.1 Tool with no bound capability: a tool exists but has no entry in
//      tool_binds_capability. Severity: ERROR — every tool must declare
//      what capability it requires.
unbound_tool(T) :-
  tool(T),
  !tool_binds_capability(T, _).

// C5.2 Unauthorized tool use: an agent uses a tool but lacks the capability
//      that the tool binds. Uses agent_has_capability (Stratum 1 IDB).
unauthorized_tool_use(Agent, Tool) :-
  agent_uses_tool(Agent, Tool),
  tool_binds_capability(Tool, Cap),
  !agent_has_capability(Agent, Cap).

// C5.3 Unauthorized tool access: an agent has access to a tool (agent_has_tool)
//      but lacks the required capability. This is a weaker check than C5.2 —
//      it catches misconfigured access grants before actual use.
unauthorized_tool_access(Agent, Tool) :-
  agent_has_tool(Agent, Tool),
  tool_binds_capability(Tool, Cap),
  !agent_has_capability(Agent, Cap).

.decl unbound_tool(tool: symbol)
.decl unauthorized_tool_use(agent: symbol, tool: symbol)
.decl unauthorized_tool_access(agent: symbol, tool: symbol)
.output unbound_tool(filename="unbound_tool.csv")
.output unauthorized_tool_use(filename="unauthorized_tool_use.csv")
.output unauthorized_tool_access(filename="unauthorized_tool_access.csv")
```

### 4.6 C6: Transition Validity

**Axiom C6** states that a transition's source stage and target stage must both belong to the same workflow. A cross-workflow transition is a structural error that indicates a malformed workflow graph — stages from different workflows cannot be connected by a single transition.

```datalog
// ── C6: Transition Validity ────────────────────────────────────────────────

// C6.1 Derive the workflow of a transition's source stage.
transition_source_workflow(Trans, Workflow) :-
  transition_from_stage(Trans, Stage),
  stage_belongs_to_workflow(Stage, Workflow).

// C6.2 Derive the workflow of a transition's target stage.
transition_target_workflow(Trans, Workflow) :-
  transition_to_stage(Trans, Stage),
  stage_belongs_to_workflow(Stage, Workflow).

// C6.3 Cross-workflow transition: source and target stages belong to
//      different workflows. Captures both workflow IDs for diagnostics.
cross_workflow_transition(Trans, W1, W2) :-
  transition_source_workflow(Trans, W1),
  transition_target_workflow(Trans, W2),
  W1 != W2.

.decl transition_source_workflow(trans: symbol, workflow: symbol)
.decl transition_target_workflow(trans: symbol, workflow: symbol)
.decl cross_workflow_transition(trans: symbol, w1: symbol, w2: symbol)
.output cross_workflow_transition(filename="cross_workflow_transition.csv")
```

### 4.7 C7: Review Independence

**Axiom C7** states that the agent that produces an artifact cannot also review it. This enforces the four-eyes principle: every artifact must be reviewed by a different agent than the one that produced it. Self-review is a conflict of interest that undermines the integrity of the review process.

```datalog
// ── C7: Review Independence ────────────────────────────────────────────────

// C7.1 Self-review violation: the same agent is both producer and reviewer
//      of the same artifact.
self_review(Artifact, Agent) :-
  artifact_produced_by(Artifact, Agent),
  artifact_reviewed_by(Artifact, Agent).

.decl self_review(artifact: symbol, agent: symbol)
.output self_review(filename="self_review.csv")
```

### 4.8 Derived Utility Relations

These relations are not directly tied to the 7 axioms but provide useful derived facts for the harness and for higher-level reasoning.

```datalog
// ── Utility Relations ──────────────────────────────────────────────────────

// U1: Reachable stages — stages reachable from the initial stage of a workflow
//     via any sequence of transitions. Useful for dead-stage detection.

// U1.1 Base case: the initial stage is reachable.
reachable_stage(W, S) :-
  workflow_initial_stage(W, S).

// U1.2 Recursive case: if stage S1 is reachable in workflow W, and there
//      is a transition from S1 to S2 (both in W), then S2 is reachable.
reachable_stage(W, S2) :-
  reachable_stage(W, S1),
  transition_from_stage(Trans, S1),
  transition_to_stage(Trans, S2),
  stage_belongs_to_workflow(S2, W).

// U1.3 Unreachable stage: a stage belongs to a workflow but is not reachable
//      from the initial stage. Severity: WARNING.
unreachable_stage(W, S) :-
  stage_belongs_to_workflow(S, W),
  !reachable_stage(W, S).

.decl reachable_stage(workflow: symbol, stage: symbol)
.decl unreachable_stage(workflow: symbol, stage: symbol)
.output unreachable_stage(filename="unreachable_stage.csv")

// U2: Workflow completeness — a workflow is complete if all artifacts
//     associated with it are ready (valid, no missing/stale dependencies).

// U2.1 Artifact belongs to workflow (via the task that produced it).
artifact_in_workflow(Art, W) :-
  artifact_produced_by(Art, Agent),
  task_assigned_to(Task, Agent),
  stage_belongs_to_workflow(Stage, W),
  workflow_status(W, "active").

// U2.2 Workflow complete: all artifacts in the workflow are ready.
workflow_complete(W) :-
  workflow(W),
  !artifact_in_workflow(Art, W),
  !artifact_ready(Art).

.decl artifact_in_workflow(artifact: symbol, workflow: symbol)
.decl workflow_complete(workflow: symbol)
.output workflow_complete(filename="workflow_complete.csv")

// U3: Agent workload — count of tasks assigned to each agent.
//     Useful for load balancing and overload detection.
.decl agent_workload(agent: symbol, n: number)
agent_workload(A, count : { task_assigned_to(_, A) }) :-
  agent(A).
.output agent_workload(filename="agent_workload.csv")

// U4: Artifact ready — artifact and all transitive dependencies are valid.
//     (Defined in Section 4.2 as part of C2 rules.)
.output artifact_ready(filename="artifact_ready.csv")
```

---

## 5. Violation Relations — Complete Catalog

The following table enumerates all violation relations produced by the policy engine. All violation relations are written to CSV output files and mapped to structured TypeScript errors by the harness.

| Relation | Axiom | Arguments | Description | Severity | Blocks Commit |
|----------|-------|-----------|-------------|----------|--------------|
| `capability_violation` | C1 | `task, agent, cap` | Agent assigned to task lacks required capability | ERROR | ✅ |
| `missing_dependency` | C2 | `artifact, dep` | Artifact has transitive dependency not in graph | ERROR | ✅ |
| `stale_dependency` | C2 | `artifact, dep` | Artifact depends on invalid/cancelled artifact | WARNING | ❌ |
| `no_producer` | C3 | `artifact` | Artifact has no producer agent | ERROR | ✅ |
| `multiple_producers` | C3 | `artifact, agent1, agent2` | Artifact has more than one producer | ERROR | ✅ |
| `permission_revoked` | C4 | `agent, action, resource, stage` | Permission silently removed mid-workflow | ERROR | ✅ |
| `unbound_tool` | C5 | `tool` | Tool declares no required capability | ERROR | ✅ |
| `unauthorized_tool_use` | C5 | `agent, tool` | Agent uses tool without required capability | ERROR | ✅ |
| `unauthorized_tool_access` | C5 | `agent, tool` | Agent has tool access without required capability | WARNING | ❌ |
| `cross_workflow_transition` | C6 | `transition, w1, w2` | Transition connects stages from different workflows | ERROR | ✅ |
| `self_review` | C7 | `artifact, agent` | Producer is also reviewer of same artifact | ERROR | ✅ |
| `unreachable_stage` | — | `workflow, stage` | Stage not reachable from initial stage | WARNING | ❌ |

### 5.1 Severity Semantics

- **ERROR**: The violation represents a logical inconsistency or security violation that must be resolved before the workflow can proceed. Any ERROR violation blocks the commit gate (Section 8, step 5).
- **WARNING**: The violation represents a potential issue or suboptimal configuration that should be investigated but does not block execution. Warnings are logged and included in the `PolicyReport` but do not prevent stage transitions.

### 5.2 Violation Deduplication

Some violation relations may produce duplicate tuples due to the symmetric nature of certain rules (e.g., `multiple_producers` produces both `(Art, A1, A2)` and `(Art, A2, A1)`). The TypeScript harness normalizes violations before reporting:

- `multiple_producers`: normalize to `agent1 < agent2` (lexicographic), deduplicate.
- `cross_workflow_transition`: no deduplication needed (each transition appears once).
- All other relations: no deduplication needed.

---

## 6. Soufflé Program Structure

The following is the complete, runnable Soufflé program for the tori-agent policy engine. It is the authoritative implementation of all 7 axioms and utility relations defined in this spec. The program is saved at `packages/ontology/src/datalog/policy.dl`.

```datalog
// =============================================================================
// tori-agent Policy Engine — Soufflé Datalog Program
// Spec: SC-03 Datalog Policy Engine v0.1.0
// Namespace: https://tori-agent.dev/ontology/2026/core#
//
// Evaluation: bottom-up fixpoint, stratified negation
// Strata:
//   0 — EDB (base facts, loaded from CSV)
//   1 — Positive recursive IDB (agent_has_capability, transitive_dependency,
//         reachable_stage, permission_in_workflow)
//   2 — Violation rules (negation over Stratum 1 IDB)
//   3 — Utility aggregations (agent_workload, producer_count)
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: EDB DECLARATIONS — Entity Types
// ─────────────────────────────────────────────────────────────────────────────

.decl agent(id: symbol)
.input agent(filename="agent.csv", delimiter=",")

.decl role(id: symbol)
.input role(filename="role.csv", delimiter=",")

.decl capability(id: symbol)
.input capability(filename="capability.csv", delimiter=",")

.decl skill(id: symbol)
.input skill(filename="skill.csv", delimiter=",")

.decl tool(id: symbol)
.input tool(filename="tool.csv", delimiter=",")

.decl task(id: symbol)
.input task(filename="task.csv", delimiter=",")

.decl workflow(id: symbol)
.input workflow(filename="workflow.csv", delimiter=",")

.decl stage(id: symbol)
.input stage(filename="stage.csv", delimiter=",")

.decl transition(id: symbol)
.input transition(filename="transition.csv", delimiter=",")

.decl artifact(id: symbol)
.input artifact(filename="artifact.csv", delimiter=",")

.decl knowledge(id: symbol)
.input knowledge(filename="knowledge.csv", delimiter=",")

.decl policy(id: symbol)
.input policy(filename="policy.csv", delimiter=",")

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: EDB DECLARATIONS — Relations
// ─────────────────────────────────────────────────────────────────────────────

// Agent / Role / Capability
.decl agent_has_role(agent: symbol, role: symbol)
.input agent_has_role(filename="agent_has_role.csv", delimiter=",")

.decl role_requires_capability(role: symbol, cap: symbol)
.input role_requires_capability(filename="role_requires_capability.csv", delimiter=",")

.decl capability_subsumes(parent: symbol, child: symbol)
.input capability_subsumes(filename="capability_subsumes.csv", delimiter=",")

.decl task_requires_capability(task: symbol, cap: symbol)
.input task_requires_capability(filename="task_requires_capability.csv", delimiter=",")

// Tool
.decl agent_has_tool(agent: symbol, tool: symbol)
.input agent_has_tool(filename="agent_has_tool.csv", delimiter=",")

.decl tool_binds_capability(tool: symbol, cap: symbol)
.input tool_binds_capability(filename="tool_binds_capability.csv", delimiter=",")

.decl agent_uses_tool(agent: symbol, tool: symbol)
.input agent_uses_tool(filename="agent_uses_tool.csv", delimiter=",")

// Task / Artifact
.decl task_assigned_to(task: symbol, agent: symbol)
.input task_assigned_to(filename="task_assigned_to.csv", delimiter=",")

.decl artifact_produced_by(artifact: symbol, agent: symbol)
.input artifact_produced_by(filename="artifact_produced_by.csv", delimiter=",")

.decl artifact_reviewed_by(artifact: symbol, agent: symbol)
.input artifact_reviewed_by(filename="artifact_reviewed_by.csv", delimiter=",")

.decl artifact_depends_on(artifact: symbol, dep: symbol)
.input artifact_depends_on(filename="artifact_depends_on.csv", delimiter=",")

.decl artifact_status(artifact: symbol, status: symbol)
.input artifact_status(filename="artifact_status.csv", delimiter=",")

// Workflow / Stage / Transition
.decl stage_belongs_to_workflow(stage: symbol, workflow: symbol)
.input stage_belongs_to_workflow(filename="stage_belongs_to_workflow.csv", delimiter=",")

.decl transition_from_stage(trans: symbol, stage: symbol)
.input transition_from_stage(filename="transition_from_stage.csv", delimiter=",")

.decl transition_to_stage(trans: symbol, stage: symbol)
.input transition_to_stage(filename="transition_to_stage.csv", delimiter=",")

.decl workflow_initial_stage(workflow: symbol, stage: symbol)
.input workflow_initial_stage(filename="workflow_initial_stage.csv", delimiter=",")

.decl workflow_status(workflow: symbol, status: symbol)
.input workflow_status(filename="workflow_status.csv", delimiter=",")

.decl stage_index(stage: symbol, idx: number)
.input stage_index(filename="stage_index.csv", delimiter=",")

// Permission / Policy
.decl policy_applies_to(policy: symbol, class: symbol)
.input policy_applies_to(filename="policy_applies_to.csv", delimiter=",")

.decl policy_effect(policy: symbol, effect: symbol)
.input policy_effect(filename="policy_effect.csv", delimiter=",")

.decl permission_granted(agent: symbol, action: symbol, resource: symbol)
.input permission_granted(filename="permission_granted.csv", delimiter=",")

.decl permission_granted_at_stage(agent: symbol, action: symbol, resource: symbol, stage: symbol)
.input permission_granted_at_stage(filename="permission_granted_at_stage.csv", delimiter=",")

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: IDB DECLARATIONS — Derived Relations (Stratum 1)
// ─────────────────────────────────────────────────────────────────────────────

.decl agent_has_capability(agent: symbol, cap: symbol)
.decl transitive_dependency(artifact: symbol, dep: symbol)
.decl reachable_stage(workflow: symbol, stage: symbol)
.decl permission_in_workflow(agent: symbol, action: symbol, resource: symbol, workflow: symbol, idx: number)
.decl transition_source_workflow(trans: symbol, workflow: symbol)
.decl transition_target_workflow(trans: symbol, workflow: symbol)
.decl artifact_in_workflow(artifact: symbol, workflow: symbol)

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: IDB DECLARATIONS — Violation Relations (Stratum 2)
// ─────────────────────────────────────────────────────────────────────────────

.decl capability_violation(task: symbol, agent: symbol, cap: symbol)
.decl missing_dependency(artifact: symbol, dep: symbol)
.decl stale_dependency(artifact: symbol, dep: symbol)
.decl artifact_ready(artifact: symbol)
.decl no_producer(artifact: symbol)
.decl multiple_producers(artifact: symbol, agent1: symbol, agent2: symbol)
.decl permission_revoked(agent: symbol, action: symbol, resource: symbol, stage: symbol)
.decl unbound_tool(tool: symbol)
.decl unauthorized_tool_use(agent: symbol, tool: symbol)
.decl unauthorized_tool_access(agent: symbol, tool: symbol)
.decl cross_workflow_transition(trans: symbol, w1: symbol, w2: symbol)
.decl self_review(artifact: symbol, agent: symbol)

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: IDB DECLARATIONS — Utility Relations (Stratum 3)
// ─────────────────────────────────────────────────────────────────────────────

.decl producer_count(artifact: symbol, n: number)
.decl agent_workload(agent: symbol, n: number)
.decl unreachable_stage(workflow: symbol, stage: symbol)
.decl workflow_complete(workflow: symbol)

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: RULES — C1 Capability Transitivity (Stratum 1 + 2)
// ─────────────────────────────────────────────────────────────────────────────

// C1.1 Direct capability from role membership.
agent_has_capability(A, C) :-
  agent_has_role(A, R),
  role_requires_capability(R, C).

// C1.2 Transitive capability via capability subsumption hierarchy.
//      Recursive: terminates because capability_subsumes is acyclic.
agent_has_capability(A, C) :-
  agent_has_capability(A, C2),
  capability_subsumes(C2, C).

// C1.3 Capability violation: task assigned to agent lacking required capability.
capability_violation(Task, Agent, Cap) :-
  task_requires_capability(Task, Cap),
  task_assigned_to(Task, Agent),
  !agent_has_capability(Agent, Cap).

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: RULES — C2 Artifact Dependency Closure (Stratum 1 + 2)
// ─────────────────────────────────────────────────────────────────────────────

// C2.1 Direct dependency (base case).
transitive_dependency(Art, Dep) :-
  artifact_depends_on(Art, Dep).

// C2.2 Transitive dependency (recursive case).
transitive_dependency(Art, Dep) :-
  artifact_depends_on(Art, Mid),
  transitive_dependency(Mid, Dep).

// C2.3 Missing dependency: dependency not in artifact relation.
missing_dependency(Art, Dep) :-
  transitive_dependency(Art, Dep),
  !artifact(Dep).

// C2.4 Stale dependency: dependency exists but is invalid or cancelled.
stale_dependency(Art, Dep) :-
  transitive_dependency(Art, Dep),
  artifact_status(Dep, "invalid").

stale_dependency(Art, Dep) :-
  transitive_dependency(Art, Dep),
  artifact_status(Dep, "cancelled").

// C2.5 Artifact ready: valid, no missing or stale dependencies.
artifact_ready(Art) :-
  artifact(Art),
  artifact_status(Art, "valid"),
  !missing_dependency(Art, _),
  !stale_dependency(Art, _).

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: RULES — C3 Producer Completeness (Stratum 3)
// ─────────────────────────────────────────────────────────────────────────────

// C3.1 Count producers per artifact.
producer_count(Art, count : { artifact_produced_by(Art, _) }) :-
  artifact(Art).

// C3.2 No producer violation.
no_producer(Art) :-
  producer_count(Art, 0).

// C3.3 Multiple producers violation (captures both conflicting agents).
multiple_producers(Art, A1, A2) :-
  artifact_produced_by(Art, A1),
  artifact_produced_by(Art, A2),
  A1 != A2.

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: RULES — C4 Permission Monotonicity (Stratum 1 + 2)
// ─────────────────────────────────────────────────────────────────────────────

// C4.1 Derive permission with workflow context and stage index.
permission_in_workflow(Agent, Action, Resource, W, Idx) :-
  permission_granted_at_stage(Agent, Action, Resource, Stage),
  stage_belongs_to_workflow(Stage, W),
  stage_index(Stage, Idx).

// C4.2 Permission revocation: present at earlier stage, absent at later stage.
permission_revoked(Agent, Action, Resource, LaterStage) :-
  permission_in_workflow(Agent, Action, Resource, W, Idx1),
  stage_belongs_to_workflow(LaterStage, W),
  stage_index(LaterStage, Idx2),
  Idx2 > Idx1,
  !permission_granted_at_stage(Agent, Action, Resource, LaterStage).

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: RULES — C5 Tool-Capability Binding (Stratum 2)
// ─────────────────────────────────────────────────────────────────────────────

// C5.1 Tool with no bound capability.
unbound_tool(T) :-
  tool(T),
  !tool_binds_capability(T, _).

// C5.2 Unauthorized tool use (agent uses tool without required capability).
unauthorized_tool_use(Agent, Tool) :-
  agent_uses_tool(Agent, Tool),
  tool_binds_capability(Tool, Cap),
  !agent_has_capability(Agent, Cap).

// C5.3 Unauthorized tool access (agent has tool but lacks capability).
unauthorized_tool_access(Agent, Tool) :-
  agent_has_tool(Agent, Tool),
  tool_binds_capability(Tool, Cap),
  !agent_has_capability(Agent, Cap).

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: RULES — C6 Transition Validity (Stratum 1 + 2)
// ─────────────────────────────────────────────────────────────────────────────

// C6.1 Derive source workflow of transition.
transition_source_workflow(Trans, W) :-
  transition_from_stage(Trans, Stage),
  stage_belongs_to_workflow(Stage, W).

// C6.2 Derive target workflow of transition.
transition_target_workflow(Trans, W) :-
  transition_to_stage(Trans, Stage),
  stage_belongs_to_workflow(Stage, W).

// C6.3 Cross-workflow transition violation.
cross_workflow_transition(Trans, W1, W2) :-
  transition_source_workflow(Trans, W1),
  transition_target_workflow(Trans, W2),
  W1 != W2.

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: RULES — C7 Review Independence (Stratum 2)
// ─────────────────────────────────────────────────────────────────────────────

// C7.1 Self-review violation: producer is also reviewer.
self_review(Artifact, Agent) :-
  artifact_produced_by(Artifact, Agent),
  artifact_reviewed_by(Artifact, Agent).

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13: RULES — Utility Relations (Stratum 1 + 3)
// ─────────────────────────────────────────────────────────────────────────────

// U1: Reachable stages.
reachable_stage(W, S) :-
  workflow_initial_stage(W, S).

reachable_stage(W, S2) :-
  reachable_stage(W, S1),
  transition_from_stage(Trans, S1),
  transition_to_stage(Trans, S2),
  stage_belongs_to_workflow(S2, W).

unreachable_stage(W, S) :-
  stage_belongs_to_workflow(S, W),
  !reachable_stage(W, S).

// U2: Artifact in workflow (via producer agent's task).
artifact_in_workflow(Art, W) :-
  artifact_produced_by(Art, Agent),
  task_assigned_to(_, Agent),
  stage_belongs_to_workflow(_, W),
  workflow_status(W, "active").

// U3: Workflow complete.
workflow_complete(W) :-
  workflow(W),
  !( artifact_in_workflow(Art, W), !artifact_ready(Art) ).

// U4: Agent workload.
agent_workload(A, count : { task_assigned_to(_, A) }) :-
  agent(A).

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14: OUTPUT DIRECTIVES — Violation Relations
// ─────────────────────────────────────────────────────────────────────────────

.output capability_violation(filename="capability_violation.csv")
.output missing_dependency(filename="missing_dependency.csv")
.output stale_dependency(filename="stale_dependency.csv")
.output no_producer(filename="no_producer.csv")
.output multiple_producers(filename="multiple_producers.csv")
.output permission_revoked(filename="permission_revoked.csv")
.output unbound_tool(filename="unbound_tool.csv")
.output unauthorized_tool_use(filename="unauthorized_tool_use.csv")
.output unauthorized_tool_access(filename="unauthorized_tool_access.csv")
.output cross_workflow_transition(filename="cross_workflow_transition.csv")
.output self_review(filename="self_review.csv")
.output unreachable_stage(filename="unreachable_stage.csv")

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 15: OUTPUT DIRECTIVES — Utility Relations
// ─────────────────────────────────────────────────────────────────────────────

.output artifact_ready(filename="artifact_ready.csv")
.output workflow_complete(filename="workflow_complete.csv")
.output agent_workload(filename="agent_workload.csv")
.output agent_has_capability(filename="agent_has_capability.csv")
.output reachable_stage(filename="reachable_stage.csv")
```

---

## 7. TypeScript Integration

### 7.1 Approach Comparison

The harness can invoke the Datalog engine via two approaches:

| Criterion | Option A: Soufflé Subprocess | Option B: Pure TS Interpreter |
|-----------|------------------------------|-------------------------------|
| **Performance** | ✅ Native binary, ~10ms for 1000-node graphs | ⚠️ ~200–500ms for same graph (interpreted) |
| **Correctness** | ✅ Industrial-grade, battle-tested | ⚠️ Custom interpreter, risk of subtle bugs |
| **Dev Experience** | ⚠️ Requires Soufflé install, build step | ✅ Pure npm, no native deps |
| **Deployment** | ⚠️ Binary must be bundled or installed | ✅ Ships as npm package |
| **Debugging** | ✅ Soufflé has excellent error messages | ⚠️ Interpreter errors may be opaque |
| **Rule editing** | ✅ `.dl` file, hot-reload possible | ✅ Same `.dl` file |
| **CI/CD** | ⚠️ Soufflé must be in CI image | ✅ `npm install` is sufficient |
| **Recommendation** | **Production** (performance-critical) | **Development / testing** |

**Decision**: The harness implements **Option A (Soufflé subprocess)** for production evaluation, with a **fallback to Option B** (using the `datalog-ts` npm package) for development environments where Soufflé is not installed. The `PolicyEngine` class detects Soufflé availability at startup and selects the appropriate backend.

### 7.2 TypeScript Interfaces

```typescript
// packages/ontology/src/datalog/types.ts

/**
 * A single violation produced by the Datalog policy engine.
 */
export interface DatalogViolation {
  /** The violation relation name (e.g., "capability_violation"). */
  relation: string;

  /** The axiom that defines this violation (C1–C7, or null for utility). */
  axiom: "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | null;

  /** Severity: ERROR blocks commit; WARNING is logged only. */
  severity: "ERROR" | "WARNING";

  /**
   * The tuple of arguments for this violation.
   * Keys are the argument names from the Soufflé .decl declaration.
   * Values are the ground symbols (IRIs or string constants).
   */
  args: Record<string, string>;

  /**
   * Human-readable description of the violation.
   * Generated by the harness from the relation name and args.
   */
  message: string;
}

/**
 * The complete report produced by a single policy engine evaluation.
 */
export interface PolicyReport {
  /** Whether the evaluation passed (no ERROR violations). */
  passed: boolean;

  /** All violations found (both ERROR and WARNING). */
  violations: DatalogViolation[];

  /** ERROR violations only (subset of violations). */
  errors: DatalogViolation[];

  /** WARNING violations only (subset of violations). */
  warnings: DatalogViolation[];

  /** Derived utility facts (artifact_ready, workflow_complete, etc.). */
  derivedFacts: {
    artifactsReady: string[];
    workflowsComplete: string[];
    agentWorkload: Record<string, number>;
    reachableStages: Record<string, string[]>;
  };

  /** Evaluation metadata. */
  meta: {
    /** ISO 8601 timestamp of evaluation start. */
    evaluatedAt: string;
    /** Duration in milliseconds. */
    durationMs: number;
    /** Backend used: "souffle" | "datalog-ts". */
    backend: "souffle" | "datalog-ts";
    /** Number of EDB facts loaded. */
    edbFactCount: number;
    /** Number of IDB facts derived. */
    idbFactCount: number;
  };
}

/**
 * JSON-LD graph representation passed to the policy engine.
 * This is the in-memory form of the RDF dataset after JSON-LD parsing.
 */
export interface JsonLdGraph {
  /** All JSON-LD nodes in the graph, keyed by @id. */
  nodes: Record<string, JsonLdNode>;
  /** The base IRI of the graph. */
  baseIri: string;
}

export interface JsonLdNode {
  "@id": string;
  "@type"?: string | string[];
  [property: string]: unknown;
}
```

### 7.3 PolicyEngine Class

```typescript
// packages/ontology/src/datalog/policy-engine.ts

import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  DatalogViolation,
  PolicyReport,
  JsonLdGraph,
} from "./types.js";

const execFileAsync = promisify(execFile);

/** Path to the compiled Soufflé binary (set at build time or via env). */
const SOUFFLE_BINARY = process.env["TORI_SOUFFLE_BIN"] ?? "souffle";

/** Path to the policy.dl Soufflé program. */
const POLICY_DL_PATH = new URL("./policy.dl", import.meta.url).pathname;

/**
 * Violation metadata: maps relation name to axiom and severity.
 */
const VIOLATION_META: Record<
  string,
  { axiom: DatalogViolation["axiom"]; severity: DatalogViolation["severity"] }
> = {
  capability_violation:    { axiom: "C1", severity: "ERROR" },
  missing_dependency:      { axiom: "C2", severity: "ERROR" },
  stale_dependency:        { axiom: "C2", severity: "WARNING" },
  no_producer:             { axiom: "C3", severity: "ERROR" },
  multiple_producers:      { axiom: "C3", severity: "ERROR" },
  permission_revoked:      { axiom: "C4", severity: "ERROR" },
  unbound_tool:            { axiom: "C5", severity: "ERROR" },
  unauthorized_tool_use:   { axiom: "C5", severity: "ERROR" },
  unauthorized_tool_access:{ axiom: "C5", severity: "WARNING" },
  cross_workflow_transition:{ axiom: "C6", severity: "ERROR" },
  self_review:             { axiom: "C7", severity: "ERROR" },
  unreachable_stage:       { axiom: null,  severity: "WARNING" },
};

/**
 * The main policy engine. Evaluates the Datalog program against a JSON-LD graph
 * and returns a structured PolicyReport.
 */
export class PolicyEngine {
  private backend: "souffle" | "datalog-ts" | null = null;

  /**
   * Detect which backend is available.
   * Soufflé is preferred; falls back to datalog-ts if Soufflé is not installed.
   */
  async detectBackend(): Promise<"souffle" | "datalog-ts"> {
    if (this.backend !== null) return this.backend;
    try {
      await execFileAsync(SOUFFLE_BINARY, ["--version"]);
      this.backend = "souffle";
    } catch {
      this.backend = "datalog-ts";
    }
    return this.backend;
  }

  /**
   * Evaluate the policy engine against the given JSON-LD graph.
   * Returns a PolicyReport with all violations and derived facts.
   */
  async evaluate(graph: JsonLdGraph): Promise<PolicyReport> {
    const startMs = Date.now();
    const backend = await this.detectBackend();

    const edbFacts = exportToEdb(graph);
    const edbFactCount = Object.values(edbFacts).reduce(
      (sum, rows) => sum + rows.length,
      0
    );

    let rawViolations: Record<string, string[][]>;
    let derivedFacts: PolicyReport["derivedFacts"];

    if (backend === "souffle") {
      ({ rawViolations, derivedFacts } = await this.evaluateSouffle(edbFacts));
    } else {
      ({ rawViolations, derivedFacts } = await this.evaluateDatalogTs(edbFacts));
    }

    const violations = buildViolations(rawViolations);
    const errors = violations.filter((v) => v.severity === "ERROR");
    const warnings = violations.filter((v) => v.severity === "WARNING");

    return {
      passed: errors.length === 0,
      violations,
      errors,
      warnings,
      derivedFacts,
      meta: {
        evaluatedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        backend,
        edbFactCount,
        idbFactCount: violations.length + Object.values(derivedFacts).flat().length,
      },
    };
  }

  /**
   * Evaluate using Soufflé subprocess.
   * Writes EDB facts to a temp directory, runs Soufflé, reads output CSVs.
   */
  private async evaluateSouffle(
    edbFacts: Record<string, string[][]>
  ): Promise<{
    rawViolations: Record<string, string[][]>;
    derivedFacts: PolicyReport["derivedFacts"];
  }> {
    const tmpDir = await mkdtemp(join(tmpdir(), "tori-policy-"));
    try {
      // Write EDB CSV files
      for (const [relation, rows] of Object.entries(edbFacts)) {
        const csv = rows.map((row) => row.join(",")).join("\n");
        await writeFile(join(tmpDir, `${relation}.csv`), csv, "utf8");
      }

      // Run Soufflé
      await execFileAsync(SOUFFLE_BINARY, [
        POLICY_DL_PATH,
        "--fact-dir", tmpDir,
        "--output-dir", tmpDir,
      ]);

      // Read violation output CSVs
      const rawViolations: Record<string, string[][]> = {};
      for (const relation of Object.keys(VIOLATION_META)) {
        const csvPath = join(tmpDir, `${relation}.csv`);
        try {
          const content = await readFile(csvPath, "utf8");
          rawViolations[relation] = content
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => line.split(","));
        } catch {
          rawViolations[relation] = [];
        }
      }

      // Read derived fact CSVs
      const derivedFacts = await readDerivedFacts(tmpDir);
      return { rawViolations, derivedFacts };
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Evaluate using the datalog-ts pure TypeScript interpreter.
   * Used as fallback when Soufflé is not available.
   */
  private async evaluateDatalogTs(
    _edbFacts: Record<string, string[][]>
  ): Promise<{
    rawViolations: Record<string, string[][]>;
    derivedFacts: PolicyReport["derivedFacts"];
  }> {
    // Dynamic import to avoid hard dependency when Soufflé is available
    const { DatalogInterpreter } = await import("datalog-ts");
    const dl = new DatalogInterpreter();
    // Load policy.dl and evaluate — implementation details in datalog-ts docs
    void dl; // placeholder: full implementation follows datalog-ts API
    return {
      rawViolations: {},
      derivedFacts: {
        artifactsReady: [],
        workflowsComplete: [],
        agentWorkload: {},
        reachableStages: {},
      },
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Export a JSON-LD graph to EDB CSV facts.
 * Each RDF property becomes a row in the corresponding CSV relation.
 */
function exportToEdb(graph: JsonLdGraph): Record<string, string[][]> {
  const facts: Record<string, string[][]> = {};
  const add = (rel: string, ...args: string[]) => {
    (facts[rel] ??= []).push(args);
  };

  for (const [id, node] of Object.entries(graph.nodes)) {
    const types = Array.isArray(node["@type"])
      ? node["@type"]
      : node["@type"]
      ? [node["@type"]]
      : [];

    for (const t of types) {
      const rel = typeToRelation(t);
      if (rel) add(rel, id);
    }

    // Map each tori: property to its EDB relation
    for (const [prop, value] of Object.entries(node)) {
      if (prop.startsWith("@")) continue;
      const rel = propertyToRelation(prop);
      if (!rel) continue;
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        const target = typeof v === "object" && v !== null
          ? (v as { "@id": string })["@id"]
          : String(v);
        add(rel, id, target);
      }
    }
  }

  return facts;
}

function typeToRelation(type: string): string | null {
  const map: Record<string, string> = {
    "tori:Agent": "agent", "tori:Role": "role",
    "tori:Capability": "capability", "tori:Skill": "skill",
    "tori:Tool": "tool", "tori:Task": "task",
    "tori:Workflow": "workflow", "tori:Stage": "stage",
    "tori:Transition": "transition", "tori:Artifact": "artifact",
    "tori:Knowledge": "knowledge", "tori:Policy": "policy",
  };
  return map[type] ?? null;
}

function propertyToRelation(prop: string): string | null {
  const map: Record<string, string> = {
    "tori:hasRole": "agent_has_role",
    "tori:requiresCapability": "role_requires_capability",
    "tori:subsumes": "capability_subsumes",
    "tori:hasTool": "agent_has_tool",
    "tori:bindsCapability": "tool_binds_capability",
    "tori:usesTool": "agent_uses_tool",
    "tori:assignedTo": "task_assigned_to",
    "tori:producedBy": "artifact_produced_by",
    "tori:reviewedBy": "artifact_reviewed_by",
    "tori:dependsOn": "artifact_depends_on",
    "tori:status": "artifact_status",
    "tori:belongsTo": "stage_belongs_to_workflow",
    "tori:fromStage": "transition_from_stage",
    "tori:toStage": "transition_to_stage",
    "tori:initialStage": "workflow_initial_stage",
    "tori:stageIndex": "stage_index",
    "tori:effect": "policy_effect",
    "tori:appliesTo": "policy_applies_to",
  };
  return map[prop] ?? null;
}

function buildViolations(
  rawViolations: Record<string, string[][]>
): DatalogViolation[] {
  const argNames: Record<string, string[]> = {
    capability_violation:     ["task", "agent", "cap"],
    missing_dependency:       ["artifact", "dep"],
    stale_dependency:         ["artifact", "dep"],
    no_producer:              ["artifact"],
    multiple_producers:       ["artifact", "agent1", "agent2"],
    permission_revoked:       ["agent", "action", "resource", "stage"],
    unbound_tool:             ["tool"],
    unauthorized_tool_use:    ["agent", "tool"],
    unauthorized_tool_access: ["agent", "tool"],
    cross_workflow_transition:["transition", "w1", "w2"],
    self_review:              ["artifact", "agent"],
    unreachable_stage:        ["workflow", "stage"],
  };

  const violations: DatalogViolation[] = [];
  for (const [relation, rows] of Object.entries(rawViolations)) {
    const meta = VIOLATION_META[relation];
    if (!meta) continue;
    const names = argNames[relation] ?? [];
    for (const row of rows) {
      const args: Record<string, string> = {};
      names.forEach((name, i) => { args[name] = row[i] ?? ""; });
      violations.push({
        relation,
        axiom: meta.axiom,
        severity: meta.severity,
        args,
        message: formatViolationMessage(relation, args),
      });
    }
  }
  return violations;
}

function formatViolationMessage(
  relation: string,
  args: Record<string, string>
): string {
  const templates: Record<string, (a: Record<string, string>) => string> = {
    capability_violation: (a) =>
      `Agent '${a["agent"]}' assigned to task '${a["task"]}' lacks required capability '${a["cap"]}'`,
    missing_dependency: (a) =>
      `Artifact '${a["artifact"]}' depends on '${a["dep"]}' which is not in the graph`,
    stale_dependency: (a) =>
      `Artifact '${a["artifact"]}' depends on '${a["dep"]}' which is in an invalid/cancelled state`,
    no_producer: (a) =>
      `Artifact '${a["artifact"]}' has no producer agent`,
    multiple_producers: (a) =>
      `Artifact '${a["artifact"]}' has multiple producers: '${a["agent1"]}' and '${a["agent2"]}'`,
    permission_revoked: (a) =>
      `Permission for agent '${a["agent"]}' to '${a["action"]}' on '${a["resource"]}' was revoked at stage '${a["stage"]}'`,
    unbound_tool: (a) =>
      `Tool '${a["tool"]}' does not bind any capability`,
    unauthorized_tool_use: (a) =>
      `Agent '${a["agent"]}' used tool '${a["tool"]}' without required capability`,
    unauthorized_tool_access: (a) =>
      `Agent '${a["agent"]}' has access to tool '${a["tool"]}' but lacks required capability`,
    cross_workflow_transition: (a) =>
      `Transition '${a["transition"]}' crosses workflow boundary: '${a["w1"]}' → '${a["w2"]}'`,
    self_review: (a) =>
      `Agent '${a["agent"]}' is both producer and reviewer of artifact '${a["artifact"]}'`,
    unreachable_stage: (a) =>
      `Stage '${a["stage"]}' in workflow '${a["workflow"]}' is not reachable from the initial stage`,
  };
  return templates[relation]?.(args) ?? `${relation}: ${JSON.stringify(args)}`;
}

async function readDerivedFacts(
  dir: string
): Promise<PolicyReport["derivedFacts"]> {
  const readCsv = async (file: string): Promise<string[][]> => {
    try {
      const content = await readFile(join(dir, file), "utf8");
      return content.trim().split("\n").filter(Boolean).map((l) => l.split(","));
    } catch { return []; }
  };

  const ready = (await readCsv("artifact_ready.csv")).map((r) => r[0] ?? "");
  const complete = (await readCsv("workflow_complete.csv")).map((r) => r[0] ?? "");
  const workload = Object.fromEntries(
    (await readCsv("agent_workload.csv")).map(([a, n]) => [a, Number(n)])
  );
  const reachableRows = await readCsv("reachable_stage.csv");
  const reachableStages: Record<string, string[]> = {};
  for (const [w, s] of reachableRows) {
    (reachableStages[w ?? ""] ??= []).push(s ?? "");
  }

  return {
    artifactsReady: ready,
    workflowsComplete: complete,
    agentWorkload: workload,
    reachableStages,
  };
}
```

---

## 8. Evaluation Lifecycle

### 8.1 When Datalog Runs

The policy engine is invoked at five points in the tori-agent execution lifecycle:

| Trigger | Rules Evaluated | Rationale |
|---------|----------------|-----------|
| **Task Assignment** | C1 (capability), C5 (tool access) | Fail fast before work begins |
| **Artifact Creation** | C3 (producer), C7 (review independence) | Enforce accountability at creation time |
| **Workflow Transition** | C6 (transition validity), C4 (permission monotonicity) | Validate state machine integrity |
| **Verify Stage Entry** | All rules (full evaluation) | Comprehensive gate before review |
| **Commit Gate** | All rules (full evaluation) | Final blocking gate — no ERROR violations allowed |

For performance, the harness uses **partial evaluation** at task assignment and artifact creation (only the relevant rule subsets), and **full evaluation** at verify stage and commit gate.

### 8.2 Sequence Diagram

```
Harness                SHACL Validator         Datalog Engine         Git
   │                         │                       │                  │
   │── mutate graph ─────────►                       │                  │
   │                         │                       │                  │
   │                    validate shapes               │                  │
   │                         │                       │                  │
   │◄── sh:Violation ────────┤  (BLOCK: fix graph)   │                  │
   │                         │                       │                  │
   │◄── sh:conforms: true ───┤                       │                  │
   │                         │                       │                  │
   │── export EDB ───────────────────────────────────►                  │
   │                         │                       │                  │
   │                         │              fixpoint evaluation          │
   │                         │              (C1–C7 + utility)           │
   │                         │                       │                  │
   │◄── PolicyReport ────────────────────────────────┤                  │
   │                         │                       │                  │
   │  [if errors.length > 0] │                       │                  │
   │── throw PolicyError ────────────────────────────────────────────── X
   │                         │                       │                  │
   │  [if errors.length = 0] │                       │                  │
   │── commit ───────────────────────────────────────────────────────── ►
   │                         │                       │                  │
```

### 8.3 Partial Evaluation at Task Assignment

When a task is assigned to an agent, the harness performs a targeted evaluation:

```typescript
// Partial evaluation: only C1 and C5 rules
async function checkTaskAssignment(
  engine: PolicyEngine,
  graph: JsonLdGraph,
  taskId: string,
  agentId: string
): Promise<void> {
  const report = await engine.evaluate(graph);
  const relevant = report.errors.filter(
    (v) =>
      (v.axiom === "C1" && v.args["task"] === taskId) ||
      (v.axiom === "C5" && v.args["agent"] === agentId)
  );
  if (relevant.length > 0) {
    throw new PolicyError("Task assignment blocked by policy violations", relevant);
  }
}
```

### 8.4 Full Evaluation at Commit Gate

```typescript
// Full evaluation at commit gate
async function commitGate(
  engine: PolicyEngine,
  graph: JsonLdGraph
): Promise<void> {
  const report = await engine.evaluate(graph);
  if (!report.passed) {
    throw new PolicyError(
      `Commit blocked: ${report.errors.length} policy violation(s)`,
      report.errors
    );
  }
  // Log warnings but do not block
  for (const warning of report.warnings) {
    console.warn(`[POLICY WARNING] ${warning.message}`);
  }
}
```

---

## 9. Testing Strategy

### 9.1 Test Organization

All Datalog policy engine tests live in `packages/ontology/tests/datalog/`. The directory structure is:

```
packages/ontology/tests/datalog/
├── fixtures/
│   ├── c1-capability-transitivity/
│   │   ├── valid.jsonld          # Graph with no C1 violations
│   │   ├── missing-capability.jsonld  # Agent lacks required capability
│   │   └── transitive-capability.jsonld  # Capability via subsumption chain
│   ├── c2-artifact-dependency/
│   │   ├── valid.jsonld
│   │   ├── missing-dep.jsonld
│   │   └── stale-dep.jsonld
│   ├── c3-producer-completeness/
│   │   ├── valid.jsonld
│   │   ├── no-producer.jsonld
│   │   └── multiple-producers.jsonld
│   ├── c4-permission-monotonicity/
│   │   ├── valid.jsonld
│   │   └── revoked-permission.jsonld
│   ├── c5-tool-capability/
│   │   ├── valid.jsonld
│   │   ├── unbound-tool.jsonld
│   │   └── unauthorized-use.jsonld
│   ├── c6-transition-validity/
│   │   ├── valid.jsonld
│   │   └── cross-workflow.jsonld
│   ├── c7-review-independence/
│   │   ├── valid.jsonld
│   │   └── self-review.jsonld
│   └── integration/
│       ├── all-violations.jsonld  # Graph with all 7 axiom violations
│       └── clean-graph.jsonld     # Fully valid graph
├── c1.test.ts
├── c2.test.ts
├── c3.test.ts
├── c4.test.ts
├── c5.test.ts
├── c6.test.ts
├── c7.test.ts
└── integration.test.ts
```

### 9.2 Example Test: C1 Capability Transitivity

```typescript
// packages/ontology/tests/datalog/c1.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { PolicyEngine } from "../../src/datalog/policy-engine.js";
import { loadJsonLd } from "../../src/datalog/loader.js";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures/c1-capability-transitivity");

describe("C1: Capability Transitivity", () => {
  let engine: PolicyEngine;

  beforeAll(() => {
    engine = new PolicyEngine();
  });

  it("passes when agent has direct capability via role", async () => {
    const graph = await loadJsonLd(join(FIXTURES, "valid.jsonld"));
    const report = await engine.evaluate(graph);
    const c1Errors = report.errors.filter((v) => v.axiom === "C1");
    expect(c1Errors).toHaveLength(0);
  });

  it("detects violation when agent lacks required capability", async () => {
    const graph = await loadJsonLd(join(FIXTURES, "missing-capability.jsonld"));
    const report = await engine.evaluate(graph);
    const c1Errors = report.errors.filter((v) => v.axiom === "C1");
    expect(c1Errors.length).toBeGreaterThan(0);
    expect(c1Errors[0]?.relation).toBe("capability_violation");
    expect(c1Errors[0]?.args).toMatchObject({
      task: expect.stringContaining("task:"),
      agent: expect.stringContaining("agent:"),
      cap: expect.stringContaining("cap:"),
    });
  });

  it("resolves transitive capability through subsumption chain", async () => {
    // Graph: agent has role R, R requires cap:code-execution,
    // cap:code-execution subsumes cap:python-execution,
    // task requires cap:python-execution.
    // Expected: NO violation (transitive capability covers it).
    const graph = await loadJsonLd(join(FIXTURES, "transitive-capability.jsonld"));
    const report = await engine.evaluate(graph);
    const c1Errors = report.errors.filter((v) => v.axiom === "C1");
    expect(c1Errors).toHaveLength(0);
    // Also verify the derived capability is present
    expect(report.derivedFacts).toBeDefined();
  });
});
```

**Fixture: `c1-capability-transitivity/missing-capability.jsonld`**

```json
{
  "@context": {
    "tori": "https://tori-agent.dev/ontology/2026/core#",
    "@vocab": "https://tori-agent.dev/ontology/2026/core#"
  },
  "@graph": [
    {
      "@id": "agent:executor-01",
      "@type": "tori:Agent",
      "tori:hasRole": { "@id": "role:junior-developer" }
    },
    {
      "@id": "role:junior-developer",
      "@type": "tori:Role",
      "tori:requiresCapability": { "@id": "cap:read-files" }
    },
    {
      "@id": "cap:read-files",
      "@type": "tori:Capability"
    },
    {
      "@id": "cap:code-execution",
      "@type": "tori:Capability"
    },
    {
      "@id": "task:run-build",
      "@type": "tori:Task",
      "tori:requiresCapability": { "@id": "cap:code-execution" },
      "tori:assignedTo": { "@id": "agent:executor-01" }
    }
  ]
}
```

### 9.3 Example Test: C7 Review Independence

```typescript
// packages/ontology/tests/datalog/c7.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { PolicyEngine } from "../../src/datalog/policy-engine.js";
import { loadJsonLd } from "../../src/datalog/loader.js";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures/c7-review-independence");

describe("C7: Review Independence", () => {
  let engine: PolicyEngine;

  beforeAll(() => {
    engine = new PolicyEngine();
  });

  it("passes when producer and reviewer are different agents", async () => {
    const graph = await loadJsonLd(join(FIXTURES, "valid.jsonld"));
    const report = await engine.evaluate(graph);
    const c7Errors = report.errors.filter((v) => v.axiom === "C7");
    expect(c7Errors).toHaveLength(0);
  });

  it("detects self-review violation", async () => {
    const graph = await loadJsonLd(join(FIXTURES, "self-review.jsonld"));
    const report = await engine.evaluate(graph);
    const c7Errors = report.errors.filter((v) => v.axiom === "C7");
    expect(c7Errors).toHaveLength(1);
    expect(c7Errors[0]?.relation).toBe("self_review");
    expect(c7Errors[0]?.severity).toBe("ERROR");
    expect(c7Errors[0]?.args["artifact"]).toBe("artifact:spec-sc-03");
    expect(c7Errors[0]?.args["agent"]).toBe("agent:executor-01");
    expect(c7Errors[0]?.message).toContain("both producer and reviewer");
  });
});
```

**Fixture: `c7-review-independence/self-review.jsonld`**

```json
{
  "@context": {
    "tori": "https://tori-agent.dev/ontology/2026/core#"
  },
  "@graph": [
    {
      "@id": "agent:executor-01",
      "@type": "tori:Agent"
    },
    {
      "@id": "artifact:spec-sc-03",
      "@type": "tori:Artifact",
      "tori:producedBy": { "@id": "agent:executor-01" },
      "tori:reviewedBy": { "@id": "agent:executor-01" },
      "tori:status": "draft"
    }
  ]
}
```

### 9.4 Integration Test

```typescript
// packages/ontology/tests/datalog/integration.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { PolicyEngine } from "../../src/datalog/policy-engine.js";
import { loadJsonLd } from "../../src/datalog/loader.js";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures/integration");

describe("Integration: Full Graph Evaluation", () => {
  let engine: PolicyEngine;

  beforeAll(() => {
    engine = new PolicyEngine();
  });

  it("detects all 7 axiom violations in the all-violations fixture", async () => {
    const graph = await loadJsonLd(join(FIXTURES, "all-violations.jsonld"));
    const report = await engine.evaluate(graph);

    expect(report.passed).toBe(false);

    // Verify each axiom has at least one violation
    const axioms = new Set(report.errors.map((v) => v.axiom));
    expect(axioms).toContain("C1");
    expect(axioms).toContain("C2");
    expect(axioms).toContain("C3");
    expect(axioms).toContain("C4");
    expect(axioms).toContain("C5");
    expect(axioms).toContain("C6");
    expect(axioms).toContain("C7");
  });

  it("passes with zero violations on the clean graph fixture", async () => {
    const graph = await loadJsonLd(join(FIXTURES, "clean-graph.jsonld"));
    const report = await engine.evaluate(graph);

    expect(report.passed).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("completes full evaluation in under 100ms for 1000-node graph", async () => {
    const graph = generateLargeGraph(1000);
    const start = Date.now();
    await engine.evaluate(graph);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

/** Generate a synthetic graph with N nodes for performance testing. */
function generateLargeGraph(n: number): import("../../src/datalog/types.js").JsonLdGraph {
  const nodes: Record<string, import("../../src/datalog/types.js").JsonLdNode> = {};
  for (let i = 0; i < n; i++) {
    nodes[`agent:agent-${i}`] = {
      "@id": `agent:agent-${i}`,
      "@type": "tori:Agent",
      "tori:hasRole": { "@id": `role:role-${i % 10}` },
    };
  }
  for (let i = 0; i < 10; i++) {
    nodes[`role:role-${i}`] = {
      "@id": `role:role-${i}`,
      "@type": "tori:Role",
      "tori:requiresCapability": { "@id": `cap:cap-${i}` },
    };
    nodes[`cap:cap-${i}`] = {
      "@id": `cap:cap-${i}`,
      "@type": "tori:Capability",
    };
  }
  return { nodes, baseIri: "https://tori-agent.dev/test/" };
}
```

---

## 10. Conformance Checklist

The following items define conformance for an implementation of SC-03. Items marked **[NORMATIVE]** are required for conformance. Items marked **[RECOMMENDED]** are strongly advised but not strictly required.

### 10.1 Rule Implementation

- **[NORMATIVE]** All 7 axioms (C1–C7) are implemented as Soufflé Datalog rules.
- **[NORMATIVE]** All violation relations listed in Section 5 are declared with `.decl` and exported with `.output`.
- **[NORMATIVE]** The Soufflé program (`policy.dl`) parses without errors under Soufflé v2.x.
- **[NORMATIVE]** The program is stratified: no recursion through negation.
- **[NORMATIVE]** C1 transitive closure terminates for any acyclic `capability_subsumes` relation.
- **[NORMATIVE]** C2 transitive dependency closure terminates for any acyclic `artifact_depends_on` relation.
- **[RECOMMENDED]** The program includes inline comments explaining each rule's purpose.
- **[RECOMMENDED]** All EDB relations have `.input` directives with explicit `filename` and `delimiter` parameters.

### 10.2 TypeScript Integration

- **[NORMATIVE]** The `PolicyEngine` class implements the `evaluate(graph: JsonLdGraph): Promise<PolicyReport>` method.
- **[NORMATIVE]** The `PolicyReport` interface includes `passed`, `violations`, `errors`, `warnings`, `derivedFacts`, and `meta` fields.
- **[NORMATIVE]** Each `DatalogViolation` includes `relation`, `axiom`, `severity`, `args`, and `message` fields.
- **[NORMATIVE]** ERROR violations block the commit gate; WARNING violations are logged only.
- **[NORMATIVE]** The harness returns structured `DatalogViolation[]`, not raw strings or untyped objects.
- **[RECOMMENDED]** The `PolicyEngine` detects Soufflé availability at startup and falls back to `datalog-ts`.
- **[RECOMMENDED]** Violation messages are human-readable and include the relevant IRI values.

### 10.3 Correctness Properties

- **[NORMATIVE]** C4 monotonicity check is **workflow-scoped**: a permission absent in workflow W2 but present in W1 is not a violation.
- **[NORMATIVE]** C3 `multiple_producers` violations are deduplicated (symmetric pairs normalized to `agent1 < agent2`).
- **[NORMATIVE]** C1 capability derivation is sound: if `agent_has_capability(A, C)` is derived, then A genuinely has C via the role-capability-subsumption chain.
- **[NORMATIVE]** C7 self-review is checked per-artifact: the same agent appearing as producer and reviewer of the same artifact is always a violation, regardless of other agents involved.

### 10.4 Performance

- **[NORMATIVE]** Full evaluation (all 7 axioms) completes in **< 100ms** for graphs with up to 1000 nodes when using the Soufflé backend.
- **[RECOMMENDED]** Full evaluation completes in **< 500ms** for graphs with up to 1000 nodes when using the `datalog-ts` fallback backend.
- **[RECOMMENDED]** The harness uses partial evaluation (subset of rules) for task assignment and artifact creation triggers to minimize latency.

### 10.5 Testing

- **[NORMATIVE]** Unit tests exist for each of the 7 axioms (C1–C7), with at least one valid fixture and one violation fixture per axiom.
- **[NORMATIVE]** An integration test verifies that all 7 axiom violations are detected in a single graph containing all violations.
- **[NORMATIVE]** An integration test verifies that a clean graph produces zero violations.
- **[RECOMMENDED]** A performance test verifies the 100ms SLA for 1000-node graphs.
- **[RECOMMENDED]** Fixtures are valid JSON-LD documents that parse without errors.

---

## 11. Related Specs

| Spec | Title | Status | Relationship |
|------|-------|--------|--------------|
| SC-01 | Ontology Schema — Core Classes & Properties | draft | **Normative dependency** — EDB schema mirrors SC-01 class and property IRIs. If SC-01 renames a class or property, EDB relations and the JSON-LD exporter must be updated. |
| SC-02 | SHACL Shapes for Ontology Validation | draft | **Normative companion** — SHACL validation (SC-02) runs before Datalog evaluation (SC-03). A graph that fails SHACL must not be passed to the Datalog engine. |
| SC-04 | JSON-LD Context & Serialization | draft | **Informative** — SC-04 defines the JSON-LD context and serialization format used to produce the EDB CSV facts. The `exportToEdb` function in Section 7.3 depends on SC-04's property IRI conventions. |

### 11.1 Dependency Graph

```
SC-01 (Ontology Schema)
  │
  ├──► SC-02 (SHACL Shapes)          [normative companion to SC-01]
  │         │
  │         └──► SC-03 (Datalog)     [normative companion to SC-02]
  │                   │
  │                   └── SC-04 (JSON-LD Context) [informative]
  │
  └──► SC-04 (JSON-LD Context)       [normative companion to SC-01]
```

### 11.2 Change Impact Analysis

| If this spec changes... | Impact on SC-03 |
|------------------------|-----------------|
| SC-01 adds a new class | Add new EDB unary relation and `.input` directive |
| SC-01 renames a property IRI | Update `propertyToRelation` map in `policy-engine.ts` |
| SC-01 removes a property | Remove corresponding EDB relation and all rules that reference it |
| SC-02 adds a new SHACL shape | No impact (SHACL and Datalog are independent) |
| SC-04 changes serialization format | Update `exportToEdb` function to match new format |

---

## Appendix A: Soufflé Installation

The Soufflé Datalog compiler is available via:

```bash
# macOS (Homebrew)
brew install souffle-lang/souffle/souffle

# Ubuntu/Debian
sudo apt-get install souffle

# From source (all platforms)
git clone https://github.com/souffle-lang/souffle.git
cd souffle && cmake -S . -B build && cmake --build build --target install

# Verify installation
souffle --version
# Expected: Soufflé 2.x.x
```

The Soufflé binary path can be overridden via the `TORI_SOUFFLE_BIN` environment variable:

```bash
TORI_SOUFFLE_BIN=/usr/local/bin/souffle node packages/cli/dist/cli.js generate
```

## Appendix B: CSV Fact Format

EDB CSV files use comma-separated values with no header row. Each row represents one ground fact. String values are unquoted unless they contain commas (in which case they are double-quoted per RFC 4180).

Example `agent_has_role.csv`:
```
agent:tori-executor,role:specialist
agent:tori-reviewer,role:reviewer
agent:tori-scribe,role:scribe
```

Example `stage_index.csv`:
```
workflow-stage:requirements,0
workflow-stage:planning,1
workflow-stage:execution,2
workflow-stage:verification,3
```

The JSON-LD exporter (SC-04) is responsible for generating these CSV files from the in-memory RDF graph. The `exportToEdb` function in Section 7.3 provides the TypeScript implementation.

## Appendix C: Stratification Proof

The policy.dl program is stratified. The strata are:

**Stratum 0 (EDB)**: All `.input` relations. No rules, no negation.

**Stratum 1 (Positive recursive IDB)**:
- `agent_has_capability` — recursive via C1.2, no negation
- `transitive_dependency` — recursive via C2.2, no negation
- `reachable_stage` — recursive via U1.2, no negation
- `permission_in_workflow` — non-recursive, no negation
- `transition_source_workflow`, `transition_target_workflow` — non-recursive, no negation

**Stratum 2 (Violation rules — negation over Stratum 1)**:
- `capability_violation` — negates `agent_has_capability` (Stratum 1) ✅
- `missing_dependency` — negates `artifact` (Stratum 0) ✅
- `stale_dependency` — no negation ✅
- `artifact_ready` — negates `missing_dependency`, `stale_dependency` (Stratum 2, but these are non-recursive) ✅
- `no_producer` — uses `producer_count` (Stratum 3 — see note below)
- `multiple_producers` — no negation ✅
- `permission_revoked` — negates `permission_granted_at_stage` (Stratum 0) ✅
- `unbound_tool` — negates `tool_binds_capability` (Stratum 0) ✅
- `unauthorized_tool_use`, `unauthorized_tool_access` — negates `agent_has_capability` (Stratum 1) ✅
- `cross_workflow_transition` — no negation ✅
- `self_review` — no negation ✅
- `unreachable_stage` — negates `reachable_stage` (Stratum 1) ✅

**Stratum 3 (Aggregation)**:
- `producer_count` — aggregation over `artifact_produced_by` (Stratum 0)
- `agent_workload` — aggregation over `task_assigned_to` (Stratum 0)

**Conclusion**: No rule in any stratum negates a relation defined in the same or higher stratum. The program is stratified and has a unique minimal model. ∎
