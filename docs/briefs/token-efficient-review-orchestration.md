---
project: "token-efficient-review-orchestration"
type: tool
status: draft
exec_plan: docs/exec-plans/token-efficient-review-orchestration.md
created: 2026-07-29
updated: 2026-07-29
---

## Problem

Every hand-off in the team-lead orchestration flow (team-lead → sub-agent → team-lead) is a fresh-context LLM call, and `agents/prompt.md` currently biases hard toward verbosity on the way out ("be verbose in handoff prompts — it's cheaper to over-specify than to re-delegate," "the reviewer needs MORE context than the producer, not less") with no matching discipline on the way back. Reviewer sub-agents (`code-reviewer`, `security-reviewer`, `requirements-reviewer`, `review-manager`) each return a fixed, mandatory markdown template, but the templates constrain *structure*, not *size* — full requirements-coverage tables, mandatory "no issues detected" acknowledgments, and narrative "Positive Notes" sections are re-injected into team-lead's context on every review round, and cost compounds linearly through CHANGES_REQUESTED → fix → re-review loops. The plugin's own `compress`/`distill`/`prune` context-management tools exist for exactly this problem, but `prompt.md` only prescribes `compress`, using soft, non-mechanical triggers ("trust the instinct," "when context feels heavy") — `distill` and `prune` are granted permissions nobody is instructed to use.

On the quality side, the review cluster (`review-manager` + 3 reviewers) is rigorous on correctness, security, and functional compliance, but there is no lens for system-level architecture or design quality — module boundaries, coupling, abstraction fit. `code-reviewer` brushes "maintainability" but that's not the same mandate. A performance gap was explicitly flagged as known by the project; the architecture gap wasn't flagged at all, meaning today a change that introduces a bad module boundary can sail through APPROVED with zero reviewers whose job it was to catch it. Separately, a mechanical pre-filter (lint/typecheck/test short-circuit before spawning semantic reviewers) is already fully specced in `docs/specs/review-manager-mechanical-checks.md` but was never wired into the live `agents/review-manager.md` prompt — meaning every review today pays for 3 semantic reviewer calls even when a trivial lint failure would have blocked it for free.

## Vision

A multi-round review or delegation-heavy mission completes with a visibly smaller, flatter context footprint per round instead of one that grows linearly with round count — and the review cluster catches design/architecture problems with the same rigor it already applies to security and correctness.

## Users

### Primary
Developers who install and run the `opencode-team-lead` plugin on their own repositories to orchestrate multi-agent code changes — specifically those running non-trivial missions with 2+ review rounds or 4+ delegated sub-agents in a single session, where context growth becomes visible in cost and in team-lead losing track of earlier findings.

### Secondary (optional)
Plugin maintainers (this repo's own contributors) who write and tune `agents/*.md` prompts and need the review cluster to reliably surface architecture-level issues in the plugin's own codebase, not just in downstream user projects.

## Core Use Cases

### UC-001 — Compressed reviewer report-back (Priority: P1)
**As a** developer running a mid-size multi-file review, **I want** each reviewer's output to review-manager (and review-manager's synthesized output to team-lead) to carry only actionable findings, with narrative padding stripped or capped, **so that** context doesn't balloon with prose the orchestrator has to hold but never acts on.
**Acceptance criteria:**
- Given a review round where all 3 reviewers approve with no issues, when review-manager synthesizes its report, then the "no issues" acknowledgment for each reviewer is a single line, not a paragraph
- Given a review round with mixed verdicts, when the synthesized report reaches team-lead, then only unresolved findings (file:line, severity, one-line description) are present — no full narrative walkthrough of what was checked

### UC-002 — Bounded cost across iterative review-fix loops (Priority: P1)
**As a** developer iterating through 2–3 review rounds on the same change, **I want** team-lead to carry forward only unresolved findings from prior rounds instead of the full prior reports, **so that** token cost per round stays roughly flat instead of compounding with round count.
**Acceptance criteria:**
- Given round 2 of a review where round 1 flagged 3 issues and 2 are now fixed, when team-lead re-invokes review-manager, then only the 1 unresolved issue plus new findings are what round 2's report carries forward into team-lead's context — not a re-statement of round 1's full report
- Given a mission with 2+ completed review rounds, when team-lead reports back to the user, then the summary references resolved issues by reference (e.g. "issue #2 fixed") rather than re-printing their original full description

### UC-003 — Architecture/design-quality lens in review (Priority: P1)
**As a** developer introducing a new module, service boundary, or abstraction, **I want** the review cluster to explicitly evaluate architecture/design quality (coupling, boundary placement, abstraction fit) with the same rigor as security or correctness, **so that** structurally wrong designs don't get silently approved because no reviewer's mandate covers them.
**Acceptance criteria:**
- Given a change that introduces a new module boundary, when the review cluster runs, then the final report contains an explicit architecture-quality verdict section (not folded silently into general "maintainability" comments)
- Given a change with a genuinely leaky abstraction or wrong boundary, when reviewed, then this is flagged as a specific finding with file:line evidence, distinct from correctness/security findings

### UC-004 — Mechanical pre-filter before semantic review (Priority: P2)
**As a** developer submitting a change with a failing lint, typecheck, or test command, **I want** review-manager to short-circuit to CHANGES_REQUESTED before spawning any of the 3 semantic reviewers, **so that** trivial, deterministically-detectable failures don't cost 3 LLM reviewer calls.
**Acceptance criteria:**
- Given a change where the project's declared or auto-detected lint/test command fails, when review-manager runs, then the final report states "0 semantic reviewers spawned — mechanical gate failed" with the failing command's output
- Given a change where mechanical checks pass, when review-manager runs, then semantic reviewers are spawned exactly as they are today (no regression in current review depth)

## Success Criteria

- **SC-001**: In a mission with 2+ review rounds, a user comparing the final report against today's equivalent sees materially less repeated/narrative content carried across rounds — resolved issues are referenced, not re-printed.
- **SC-002**: When a reviewer approves without findings, the user-visible report shows a one-line acknowledgment per reviewer instead of a paragraph of "positive notes" prose.
- **SC-003**: A change that introduces a new module/service boundary produces a distinct, labeled architecture-quality verdict in the review-manager report — its presence or absence is directly observable in the report, not inferable only by reading code.
- **SC-004**: A change with a failing lint/build/test command receives CHANGES_REQUESTED with zero semantic reviewers spawned, observable in the report's reviewer list.

## Scope

### In scope
- A compressed report contract for reviewer → review-manager and review-manager → team-lead hand-offs: structural compression (cap/strip narrative sections, collapse "no issues" cases to one line, reference-don't-repeat resolved findings across rounds) — not lexical/style compression.
- Finishing the wiring of the already-specced `docs/specs/review-manager-mechanical-checks.md` gate into the live `agents/review-manager.md` prompt, reconciling the spec's draft/implemented frontmatter-vs-body inconsistency in the process.
- Adding an explicit architecture/design-quality mandate to the review cluster — recommendation: extend `code-reviewer`'s mandate rather than add a 5th reviewer persona (see Rejected Ideas / Open Questions for the trade-off), with a corresponding update to `docs/specs/review-cluster.md`.
- Converting `agents/prompt.md`'s Context Management triggers from soft language ("trust the instinct") to concrete, mechanical triggers (e.g., tied to review-round count or delegated-agent count), and giving `distill`/`prune` an actual instructed usage pattern instead of leaving them as unused permissions.
- Evaluating (not necessarily implementing) whether the same compressed-report contract should extend to `bug-finder`'s investigation phase and `explore` sub-agent outputs, which are also verbose and precede review/planning work.

### Out of scope
- Reviving, touching, or referencing `docs/briefs/plugin-v2-migration.md` in any way — unrelated concern (module export format), explicitly parked.
- Introducing brand-new agents unrelated to the two stated axes (no novelty agents).
- Any change to the zero-runtime-dependency constraint — no tokenizer libraries, no external diff/compression libraries.
- Any change to the `team-lead-workflow` documentation website.
- Any change to the default-deny permission philosophy itself — new capabilities still require explicit per-agent allowlisting in `index.js`.
- Building a token-counting/budget-enforcement mechanism (see Rejected Ideas).
- Changes to the brainstorm agent's own workflow.

## Constraints

- Zero runtime dependencies — any report-shaping or context-management logic must be implemented via prompt instructions and/or plain JS in `tools/lifecycle.js`; no tokenizer or NLP libraries.
- `agents/prompt.md` is currently 467 lines and `agents/review-manager.md` is 221 lines; the project's own guiding principles flag >600 lines per prompt file as needing explicit structural justification — there is limited headroom, especially in `prompt.md`.
- Agent prompt files must never declare a `## Permissions` section (CI-enforced); any new tool or capability must be wired through `index.js`'s `SUBAGENT_DEFS`/`defaultPermission`.
- `review-manager`'s cardinal rule is delegate/synthesize/arbitrate only — it must never perform review logic inline. An architecture-quality lens must live in a spawned agent's output, not in review-manager's own reasoning.
- `docs/specs/review-manager-mechanical-checks.md` already exists in a draft/implemented-inconsistent state; work here must reconcile it (finish and mark implemented, or explicitly revise) rather than create a second parallel spec.
- Any CHANGELOG entry produced by implementation work must describe the user-facing effect ("reviews now finish faster on trivial failures," "review reports are shorter across rounds"), not internal prompt mechanics.

## Open Questions

- [x] Should the compressed report contract be documented once as a shared convention (e.g. a section in `docs/guiding-principles.md` or a shared skill referenced by all reviewer prompts) versus duplicated per-agent prompt as today's exact-template convention does? Affects maintenance burden vs. per-agent tuning flexibility — needs a design decision before implementation. — Planning/team-lead
  **Resolved:** Document the structural-compression convention ONCE as a shared doc (exact location finalized in the exec-plan). Each reviewer prompt (code-reviewer, security-reviewer, requirements-reviewer, review-manager) references it with a short pointer line instead of duplicating the full compression rules inline. Rationale: `agents/prompt.md` and `agents/review-manager.md` are already near this project's documented per-prompt-file size headroom; a shared doc avoids growing prompts further. See `docs/exec-plans/token-efficient-review-orchestration.md`.
- [x] Should the architecture/design-quality lens be a mandate added to `code-reviewer` (simpler, no proportionality-cap impact, but dilutes code-reviewer's stated correctness-only lane) or a new 5th reviewer persona (cleaner separation, but adds orchestration overhead and complicates the existing size×risk proportionality cap)? — team-lead, before Planning drafts an exec-plan
  **Resolved:** New dedicated `architecture-reviewer` sub-agent, spawned by review-manager CONDITIONALLY (only when a change introduces a new module/service boundary) — not an extension of code-reviewer's mandate. Keeps code-reviewer's correctness/maintainability lane clean; zero overhead on typical changes since the spawn is conditional. `docs/specs/review-cluster.md` extended (not duplicated) to reflect this. Detailed in `docs/exec-plans/token-efficient-review-orchestration.md`.
- [x] What concrete, numeric trigger should replace "trust the instinct" in `prompt.md`'s Context Management section — e.g. "compress after every completed review round" or "after every 3rd delegated agent"? — team-lead
  **Resolved:** Compress after every completed review round, OR every 3 delegated agents, whichever comes first. Detailed in `docs/exec-plans/token-efficient-review-orchestration.md`.
- [x] Is a quantified token-reduction target worth setting, given the zero-deps constraint rules out any real token-counting instrumentation (see Rejected Ideas #3)? Or is "qualitatively terser, structurally capped" sufficient as the bar? — team-lead
  **Resolved:** No numeric target will be set. Per this brief's own Rejected Ideas section (hand-rolled token-counting tool rejected as premature/misleading given zero-deps), the success bar is qualitative and structural: sections capped/collapsed/reference-based, verifiable by inspection of before/after report shapes, not token math.

## Rejected Ideas

- **Blind adoption of cavecrew's "caveman" lexical compression style (dropping articles, fragments) for all sub-agent reports** — rejected. This plugin's review-manager arbitration protocol depends on precisely parseable severity/evidence fields (security-reviewer's attack-vector field, requirements-reviewer's evidence table); stripping grammar saves few tokens compared to stripping whole narrative *sections* (positive notes, restated context, repeated prior-round findings), and risks degrading precision in exactly the fields the arbitration logic depends on. Structural compression fits this project; lexical/style compression doesn't.
- **Reviving or repurposing `plugin-v2-migration.md` as part of this work** — explicitly out of scope per mission; unrelated concern (module export format) with no bearing on either axis.
- **A hand-rolled token-counting/budget-enforcement lifecycle tool** — rejected as premature. The zero-deps constraint blocks any real tokenizer (e.g. tiktoken-equivalent), and a word/char-count approximation would be inaccurate enough to be actively misleading if presented as a hard "budget." Structural report-shaping (presence/absence/size of sections) is measurable without fake-precise token math.
- **Review-manager performing architecture critique inline instead of spawning a dedicated reviewer/mandate** — rejected, directly violates the project's own stated cardinal rule ("review-manager does not review code — it delegates, synthesizes, arbitrates") and its delegation-only architecture principle.
- **A fixed schedule forcing `distill`/`prune` on every mission regardless of size** — rejected. Small, single-file missions don't need proactive context surgery; forcing it adds extra tool-call overhead that could be net-negative on token cost for trivial missions. Any new mechanical trigger should condition on complexity signals (review-round count, delegated-agent count) rather than firing unconditionally.
