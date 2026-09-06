# Spec : Ontological Upgrade - Master Specification Index

**Status**: Draft
**Created**: 2026-09-06
**Author**: Lead Systems Architect

## 1. Executive Summary

The 'Ontological Upgrade' mission aims to transition the Tori system from a purely procedural/instruction-based execution model to a **Neuro-symbolic Architecture**. This upgrade introduces a formal semantic layer that allows the system to reason about its own capabilities, constraints, and the structural validity of its environment.

By decoupling *meaning* (Ontology) from *logic* (Reasoning) and *execution* (Runtime), we achieve a system that is self-describing, verifiable, and capable of complex, policy-driven autonomy.

---

## 2. High-Level Architecture: The Neuro-symbolic Triad

The architecture is composed of three distinct but tightly coupled layers.

### 2.1 Semantic Core (The "What")
The foundation of the system. It defines the universe of discourse.
- **Technology Stack**: JSON-LD (Serialization), OWL (Ontology Web Language).
- **Responsibility**: Defines entities (Agents, Tools, Tasks, Artifacts), their properties, and the relationships between them.
- **Key Concept**: The *Knowledge Graph*. Every state change in the system is a mutation of this graph.

### 2.2 Reasoning Engine (The "Why" & "Should")
The cognitive layer that interprets the Semantic Core.
- **Technology Stack**: SHACL (Shapes Constraint Language), Datalog (Logic Programming).
- **Responsibility**: 
    - **Structural Validation (SHACL)**: Ensures the Knowledge Graph adheres to defined shapes (e.g., "A Task must have exactly one Assignee").
    - **Policy Reasoning (Datalog)**: Evaluates complex, rule-based constraints (e.g., "An Agent cannot access a Tool if the Tool's security clearance > Agent's clearance").
- **Key Concept**: *Inference*. Deriving new facts and permissions from existing knowledge.

### 2.3 Orchestration Runtime (The "How")
The execution layer that operationalizes reasoning.
- **Technology Stack**: TypeScript (Implementation), Capability-based Dispatcher.
- **Responsibility**: Translates reasoned permissions into actionable execution contexts. It manages the lifecycle of tasks and the dispatching of tool calls.
- **Key Concept**: *Capability Tokens*. Instead of checking permissions via ACLs, the runtime issues unforgeable tokens that represent the right to perform a specific action on a specific resource.

---

## 3. Specification Suite Structure

The Master Specification Suite is divided into three primary volumes:

### Volume I: Semantic Core Specifications
- **[Spec-SC-01] Ontology Schema**: The formal OWL definition of the Tori domain.
- **[Spec-SC-02] JSON-LD Mapping**: The mapping between ontological concepts and serialized data formats.
- **[Spec-SC-03] Graph Mutation Protocol**: How state changes are proposed and committed to the graph.

### Volume II: Reasoning Engine Specifications
- **[Spec-RE-01] SHACL Shape Definitions**: The structural constraints for all core entities.
- **[Spec-RE-02] Datalog Policy Language**: The syntax and semantics for operational reasoning rules.
- **[Spec-RE-03] Inference Lifecycle**: The process of triggering validation and reasoning during graph mutations.

### Volume III: Orchestration Runtime Specifications
- **[Spec-OR-01] Capability-based Dispatcher**: The architecture of the tool-call harness.
- **[Spec-OR-02] Token Lifecycle**: Generation, validation, and revocation of capability tokens.
- **[Spec-OR-03] Runtime-Ontology Bridge**: The mechanism for synchronizing the live execution state with the Semantic Core.

---

## 4. Technical Interfaces & Data Flow

### 4.1 The "Reasoning Loop"
1. **Mutation Proposal**: The Runtime proposes a change (e.g., `Assign Task X to Agent Y`).
2. **Structural Check**: The Reasoning Engine runs **SHACL** against the proposed graph state.
3. **Policy Check**: The Reasoning Engine runs **Datalog** queries to verify policy compliance.
4. **Commit/Reject**: If both pass, the Semantic Core is updated. If not, an error is returned to the Runtime.

### 4.2 Data Flow Diagram (Conceptual)
`Runtime (State Change) -> Reasoning Engine (SHACL/Datalog) -> Semantic Core (JSON-LD/OWL) -> Reasoning Engine (Inference) -> Runtime (Capability Token)`

---

## 5. Source of Truth Hierarchy

To prevent divergence, the system follows a strict unidirectional derivation path:

1. **Level 0: The Formal Ontology (JSON-LD/OWL)**
   - *The Absolute Truth.* All definitions originate here.
2. **Level 1: The Logic Layer (SHACL/Datalog)**
   - *The Constraint Truth.* Derived from the ontology to define what is "valid" and "allowed".
3. **Level 2: The Implementation Layer (TypeScript)**
   - *The Operational Truth.* Code is generated or strictly typed based on the Level 0 and Level 1 definitions.
4. **Level 3: The Runtime State (Live Graph)**
   - *The Temporal Truth.* The current, evolving snapshot of the system, which must always be reconcilable with Level 0.

---

## 6. Implementation Roadmap (High-Level)

1. **Phase 1: Foundation**: Define the core OWL ontology and SHACL shapes.
2. **Phase 2: Logic**: Implement the Datalog reasoning engine and policy syntax.
3. **Phase 3: Harness**: Build the Capability-based Dispatcher and the Runtime-Ontology bridge.
4. **Phase 4: Integration**: Migrate existing Tori workflows to the neuro-symbolic model.
