# ADR-002: Bounded Cognition Authority Model

## Status

Draft

## Context

Tori-agent operates through multiple artifacts: ontology records, workflow state, journals, plans, briefs, prompts, and generated task packets. Without explicit authority ordering, execution drifts into ambiguity. Stale summaries can be treated as truth, prompts can exert semantic influence they do not deserve, and investigators can waste budget reconciling artifacts that were never meant to have equal authority.

This repo optimizes for agent execution as much as human readability. Performance therefore includes more than I/O or CPU. It also includes bounded cognition: limited context windows, limited investigation budgets, evidence discipline, explicit stop conditions, and honest escalation when required context is missing.

Need model that makes present runtime truth legible, preserves audit evidence, supports compact operational views, and prevents descriptive text or convenience projections from quietly becoming policy.

## Decision

Adopt explicit authority separation for all managed artifacts and execution flows:

1. **Ontology is invariant contract and semantics authority.**
   - Canonical meaning of roles, permissions, workflow semantics, artifact classes, and transition rules lives in ontology sources.
   - Prompts, docs, and summaries may describe these semantics, but they do not define or override them.

2. **Workflow snapshot is authoritative current runtime truth.**
   - Current stage, iteration, task state, checks, and transition position come from workflow state.
   - For present-tense operational questions, snapshot is authority even when a journal entry is newer, more detailed, or more persuasive.

3. **Append-only journal is audit evidence only.**
   - Journal preserves chronology, rationale, observations, and execution evidence.
   - Journal explains how system reached current state; it does not itself define current state.
   - Corrections happen by writing newer evidence and, where required, updating authoritative state artifacts—not by reinterpreting journal as live truth.

4. **Derived operational views and task packets are non-authoritative ergonomic projections.**
   - Briefs, summaries, dashboards, reducers, task packets, and similar compact views exist to reduce cognitive load.
   - They are conveniences for bounded execution, not independent policy surfaces.
   - They must be reproducible from higher-authority sources, traceable back to those sources, and safe to discard and regenerate.

5. **Prompts and documentation are descriptive only.**
   - They explain intended behavior, usage, and rationale.
   - They are not runtime authority, state authority, or semantics authority.

6. **Execution discipline favors bounded cognition.**
   - Prefer small verified packets over broad narrative accumulation.
   - Require evidence-backed claims, bounded budgets, explicit stop conditions, and missing-context escalation.

## Authority Order

Highest to lowest authority for execution decisions:

1. Ontology contract and semantics sources
2. Workflow snapshot and current workflow state
3. Append-only journal as audit evidence
4. Derived operational views, briefs, dashboards, reducers, task packets, summaries
5. Prompts, ADRs, README, and other descriptive docs

## Conflict Resolution

- **Semantic conflict:** ontology wins.
- **Current-state conflict:** workflow snapshot wins.
- **Historical reconstruction:** journal provides evidence and rationale, but does not redefine current state.
- **Projection conflict:** derived view must be regenerated or corrected from higher-authority sources.
- **Prompt or doc conflict:** treat as documentation drift unless reflected in ontology or authoritative runtime state.

## Invariants

System must preserve these invariants:

1. **Single semantics authority:** ontology defines invariant meaning.
2. **Single current-state authority:** workflow snapshot defines current runtime truth.
3. **Journal never upgrades itself:** append-only evidence does not become live authority because it is newer, longer, or more detailed.
4. **No hidden policy in projections:** reducers, derived views, and task packets must not introduce rules, transitions, permissions, or state interpretation not recoverable from authoritative sources.
5. **Every compact view is reproducible:** if a view cannot be regenerated from cited sources, it is not trustworthy enough for operational use.
6. **Every compact view is traceable:** derived artifacts must identify upstream authoritative sources clearly enough for verification.
7. **Missing context triggers escalation:** absence of authority-backed context is reason to stop or escalate, not improvise.
8. **Evidence claims require anchors:** material claims should cite artifact, state field, check result, or journal entry.
9. **Audit trail remains append-only:** corrections happen through new evidence and updated authoritative state, not retroactive rewriting of history.
10. **Performance includes cognition:** optimizations must reduce ambiguity and review burden, not only tool calls or compute cost.

## Hidden-Policy Warning

Greatest failure mode in this model is not obvious contradiction. It is quiet policy drift inside convenience layers.

Reducers, dashboards, summaries, and task packets can accidentally smuggle decisions by omitting qualifiers, collapsing state distinctions, reordering precedence, or hard-coding interpretations that do not exist in ontology or workflow state. When this happens, ergonomic views stop being views and start acting like unreviewed policy.

System must therefore treat any derived operational artifact as suspect if it cannot answer two questions:

1. What authoritative source produced this claim?
2. What deterministic path reproduces this projection?

If those answers are missing, projection is convenience text only and must not govern execution.

## Consequences

### Positive

- Reduces ambiguity between semantics authority, current-state authority, and historical evidence.
- Lowers cognitive thrash by allowing agents to discard or regenerate non-authoritative narrative quickly.
- Improves auditability by preserving journal as evidence without conflating it with runtime truth.
- Makes compact task packets safer to use because their role is explicitly limited to ergonomic compression.
- Better supports weak, small, or free models by shrinking working context and reconciliation burden. Benefit is bounded: model choice still matters, and this design does not promise reliable reasoning beyond provided evidence.
- Makes documentation and projection drift easier to detect and correct.

### Negative

- Requires discipline to keep derived views reproducible and source-linked.
- Some human-friendly summaries become explicitly disposable, which can feel redundant.
- More escalations will surface when compact packets omit required context.
- Additional review effort may be needed around reducers and projection logic because hidden policy becomes a first-class risk.

## Risks and Honest Limits

- Model reduces ambiguity and cognitive thrash; it does **not** guarantee truth.
- Model does **not** eliminate hallucinations. It narrows where trustworthy claims should come from and makes unsupported claims easier to detect.
- If ontology or workflow snapshot is wrong or stale, derived views will inherit that wrongness faithfully.
- Over-compression can still remove needed nuance; bounded cognition requires escalation path, not blind trust in compactness.

## Alternatives Considered

1. **Flat authority across artifacts:** rejected. Maximizes ambiguity, stale-state disputes, and reconciliation cost.
2. **Journal as source of truth:** rejected. Strong for chronology and evidence; weak for present-tense execution.
3. **Prompt-led semantics:** rejected. Makes behavior hostage to descriptive text drift.
4. **No compact projections:** rejected. Pure source reading does not scale under bounded cognition, especially for weaker models or tight budgets.

## Repo Implications

- `packages/ontology` remains canonical semantics authority.
- Workflow tooling in core should continue to treat workflow state artifact as authoritative current runtime truth.
- Journals remain append-only evidence records and should not be consumed as implicit live state.
- Briefs, summaries, reducers, and task packets should be explicitly labeled non-authoritative, reproducible, and traceable to sources.
- Documentation should describe system behavior accurately, but code and tooling should not treat docs as runtime authority.
- Review and maintenance work should flag hidden policy in derived views and drift between docs, projections, ontology, and workflow state.

## Measurable Success Criteria

- Conflicting-artifact incidents can be resolved by documented precedence without ad hoc interpretation.
- Derived packets and summaries consistently include source references sufficient for reproduction and verification.
- Review findings surface projection-policy drift early rather than after execution failures.
- Investigations terminate faster through bounded budgets, stop conditions, or explicit escalation instead of prolonged artifact reconciliation.
- Agents more often request missing authority-backed context when chain is insufficient, rather than invent continuity from narrative artifacts.

## References

- `packages/ontology/src/index.ts`
- `spec/ontology/*.jsonld`
- `packages/core/src/tools/workflow.ts`
- `packages/core/src/tools/lifecycle.ts`
- `ARCHITECTURE.md`
- `CONTRIBUTING.md`
