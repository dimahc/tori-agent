---
title: "Spec : Master Treatise on Agentic Ontology"
status: draft
created: 2026-09-06
---

# Spec : Master Treatise on Agentic Ontology
# Master Treatise on Agentic Ontology

**Status:** Draft
**Target Audience:** Tori-agent Engineering Team
**Purpose:** Theoretical foundation for the 'Ontological Upgrade'

## Executive Summary
This treatise synthesizes philosophical foundations, formal knowledge representation, and cutting-edge AI agent applications to provide a rigorous framework for the `tori-agent` ontological upgrade. It moves beyond simple schema validation toward a dynamic, relational, and reasoning-capable ontological system.

---

## 1. Philosophical & Formal Foundations

### 1.1 Ontological Commitment
An agent's **ontological commitment** is the set of entities and relations it assumes to exist within its operational domain. In the context of `tori-agent`, this means the agent does not merely "process text" but operates within a structured reality defined by its schemas.
- **Formal Definition:** A system $S$ is committed to an ontology $\mathcal{O}$ if for every entity $e \in \mathcal{O}$, $S$ can reason about $e$ and its properties.
- **Agentic Implication:** The upgrade must ensure that when an agent interacts with a `spec`, it is not just parsing a file, but committing to the existence of the concepts (e.g., `Capability`, `Dependency`, `Artifact`) defined therein.

### 1.2 Taxonomy vs. Ontology
- **Taxonomy:** A hierarchical classification (e.g., `Scribe` $\subset$ `Agent`). It answers "What is this?".
- **Ontology:** A complex web of entities, classes, and multi-dimensional relationships (e.g., `Scribe` *produces* `Spec` which *is_part_of* `Project` which *is_blocked_by* `Task`). It answers "How do things relate?".
- **Upgrade Goal:** Transition `tori-agent` from a taxonomy-based system (agent types) to an ontology-based system (capability and relational graphs).

### 1.3 Mereology & Mereotopology
- **Mereology:** The logic of parts and wholes. Essential for defining the boundaries of an agent's "context" or a "task's scope."
- **Mereotopology:** The study of how parts connect and form boundaries.
- **Application:** Defining the "limit" of an agent's authority or the "boundary" of a workspace. If a `task` is a part of a `plan`, the ontology must formally define this containment and the implications for state inheritance.

### 1.4 Identity & Persistence
- **Problem:** How does an agent recognize that `Task-A` at $T_1$ is the same entity as `Task-A` at $T_2$, even if its status has changed from `Open` to `Completed`?
- **Solution:** Implementation of **Object Identity** independent of state. The ontology must decouple *intrinsic properties* (identity) from *extrinsic properties* (state/attributes).

---

## 2. Computer Science & Knowledge Representation (KR)

### 2.1 Formalisms
- **Description Logics (DL):** The mathematical foundation for most KR. We will leverage DL principles to ensure that agent capabilities are logically consistent.
- **Semantic Web (RDF/OWL):**
    - **RDF (Resource Description Framework):** The triple format `(Subject, Predicate, Object)` will serve as the underlying model for relational dependencies in `scratchpad` and `todo`.
    - **OWL (Web Ontology Language):** Provides the expressivity needed to define complex constraints (e.g., "A `Scribe` agent must have at least one `Writing` capability").
- **Knowledge Graphs:** The target architecture for the `Capability Registry`.

### 2.2 Ontology Engineering Methodologies
We will adopt principles from **NeOn**, focusing on the reuse of existing ontological resources (e.g., standard schema definitions) and the evolution of ontologies in networked environments.

### 2.3 Reasoning Engines
To prevent "Ontological Drift," the `harness` must act as a lightweight reasoner.
- **Consistency Checking:** Detecting if an agent's proposed action violates its defined capabilities or the project's structural constraints.
- **Inference:** Automatically deriving dependencies (e.g., if `Task B` depends on `Task A`, and `Task A` is part of `Plan P`, then `Task B` is implicitly related to `Plan P`).

### 2.4 Schema Languages: Expressivity vs. Complexity
| Language | Expressivity | Complexity | Use Case in Tori |
| :--- | :--- | :--- | :--- |
| **JSON Schema** | Low/Medium | Low | Basic artifact structure validation. |
| **Zod (TS)** | Medium | Low | Runtime type safety and developer ergonomics. |
| **OWL/DL** | High | High | Complex capability reasoning and dependency inference. |

---

## 3. Application to Autonomous AI Agents

### 3.1 World Models
An ontology provides the "scaffolding" for an LLM's internal world model. Instead of the LLM hallucinating relationships, the ontology provides a deterministic set of "legal" connections, grounding the agent's reasoning.

### 3.2 Neuro-symbolic Integration
The core of the upgrade is the **Neuro-symbolic Bridge**:
- **Sub-symbolic (LLM):** Generates probabilistic proposals (e.g., "I think this task depends on that one").
- **Symbolic (Ontology):** Validates and constrains these proposals against the formal schema (e.g., "Error: Task B cannot depend on Task A because they belong to different execution scopes").

### 3.3 Ontological Drift
**Ontological Drift** occurs when an agent, through long-running autonomous loops, begins to treat entities in ways not defined by its original schema (e.g., treating a `Spec` as a `Task`).
- **Mitigation:** Continuous validation via the `harness` and periodic "Ontological Alignment" checks.

### 3.4 Dynamic Ontology Evolution
Agents must be able to encounter novel entities.
- **Pattern:** *Propose $\rightarrow$ Validate $\rightarrow$ Commit*.
- An agent proposes a new relationship type; the system checks for logical contradictions; if clear, the ontology is updated (versioned) to include the new concept.

---

## 4. Architectural Patterns for Agentic Ontology

### 4.1 The Capability-Based Dispatch Pattern
Instead of: `dispatch(agent_type="scribe")`
Use: `dispatch(required_capability="specification_writing")`
The orchestrator queries the **Capability Registry** (an ontological index) to find the best-fit agent.

### 4.2 Relational Dependency Tracking
Artifacts are no longer isolated files. They are nodes in a graph.
- `Spec` $\xrightarrow{defines}$ `Capability`
- `Task` $\xrightarrow{requires}$ `Capability`
- `Agent` $\xrightarrow{possesses}$ `Capability`

---

## 5. Risk & Mitigation Matrix

| Risk | Description | Mitigation Strategy |
| :--- | :--- | :--- |
| **Logical Contradiction** | Agent proposes an action that violates schema constraints. | Implement a `harness` validation step before any state change. |
| **Ontological Drift** | Agent's internal model diverges from the formal ontology. | Periodic "Alignment" checks and strict schema enforcement on all tool outputs. |
| **Complexity Explosion** | The ontology becomes too heavy for real-time reasoning. | Use a tiered approach: JSON Schema for structure, DL for critical reasoning. |
| **Identity Crisis** | Agent loses track of entity identity through state changes. | Decouple intrinsic identity from extrinsic attributes in the schema. |

---

## 6. Glossary of Terms

- **Artifact:** Any managed file in `.opencode/` (Spec, Plan, Brief, Workflow).
- **Capability:** A discrete, verifiable skill or permission defined in an agent's spec.
- **Ontology:** The formal specification of entities, properties, and relationships in the Tori system.
- **Ontological Commitment:** The degree to which an agent adheres to the defined ontology.
- **Relational Dependency:** A formal link between two artifacts (e.g., `blocks`, `depends_on`, `part_of`).
- **Tori-Agent:** The autonomous system being upgraded.
