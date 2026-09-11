# ADR-003: Loop Guard Blocks Identical Actions Only

## Status

Accepted

## Context

The runtime loop guard enforced three cumulative "bounded cognition" budgets per workflow run: `max_investigation_actions`, `max_search_actions`, and `max_speculation_actions`. Each `read`/`glob`/`grep`/`question`-classified call incremented a counter, and the guard denied the tool once the cap was exceeded.

These caps classify by tool capability, not by action target. A session that read 100 distinct files tripped the same investigation cap as a loop re-reading the same file. In real work, the broad-read pattern is legitimate investigation and the tight loop is the pathology; the caps punished the legitimate case and produced frequent false escalations to `workflow-stage:needs-human`.

The loop guard's purpose is to stop looping on the **same action**. The same action means the same tool with the same arguments, not merely the same tool type.

## Decision

Remove enforcement of the cumulative budget caps (`max_investigation_actions`, `max_search_actions`, `max_speculation_actions`) from `enforceBoundedCognitionPreflight`. Keep the loop guard scoped to identical actions and repeated failures:

- **Identical invocation cap** (`max_identical_invocations`): denies the same tool with the same canonical argument signature repeated in a session.
- **Identical failure cap** (`max_identical_failures`): denies the same tool+args+error message repeated in a session.
- **Consecutive failure cap** (`max_consecutive_failures`): denies repeated failures in a row.
- **Missing-context handling**: missing session binding or missing workflow context still escalates through bounded-cognition failure recording.

The budget cap fields are removed from `ExecutionLoopPolicy`, the ontology loop-policy definitions (`tori.jsonld`, `reviewer.jsonld`, `specialist.jsonld`), and their identifiers in `packages/ontology/src/index.ts`.

The `bounded_cognition` block in workflow state is retained as **activity observability** only: it continues to count investigation/search/speculation-categorized calls per workflow run and is projected by `workflow_state`, but no threshold blocks execution.

## Authority Order

No change to ADR-002. The loop guard is execution discipline, not authority. Authority ordering (ontology → workflow snapshot → journal → projections → docs) is unaffected.

## Consequences

### Positive

- Legitimate broad investigation (varied reads, varied searches, varied questions) is never budget-denied.
- The guard still stops the actual pathology: tight loops re-running the exact same call, and repeated identical failures.
- Workflow activity (`bounded_cognition`) remains visible for diagnostics.
- Prompt drift resolved: reviewer/specialist/tori "budget = hard stop" wording removed.

### Negative

- Loses an automated nudge against unbounded investigation; agents must self-stop on repeated dead ends (prompts now state this explicitly).
- No enforcement backstop between "varied" and "indistinguishable-from-loop" churn; a session alternating two calls with trivial arg changes avoids the identical-action cap.
- `bounded_cognition` counters without thresholds may confuse operators expecting enforcement.

## Risks and Honest Limits

- The identical-action signature is `tool + stableStringify(args)`. Two calls that differ only in argument key order or whitespace collapse to the same signature; calls that differ in a junk argument do not.
- Escalation to `workflow-stage:needs-human` now fires only from identical-invocation, identical-failure, consecutive-failure, or missing-context paths — not from budget exhaustion.

## Alternatives Considered

1. **Keep budget caps, raise thresholds:** rejected. Turns caps into a guess about legitimate volume and still misclassifies broad reads as loops.
2. **Per-target budgets (same file re-reads cap) instead of per-tool budget:** equivalent to the identical-invocation cap already in place; no separate mechanism needed.
3. **Invert budgets into goals:** rejected, no enforcement value.

## References

- `packages/core/src/plugin/index.ts` (`enforceBoundedCognitionPreflight`, `createBudgetAwareToolExecutor`)
- `packages/core/src/policy/engine.ts` (`getExecutionLoopPolicy`)
- `packages/ontology/src/index.ts` (`ExecutionLoopPolicy`)
- `packages/core/spec/ontology/{tori,specialist,reviewer}.jsonld`
- docs/adr/002-bounded-cognition-authority-model.md