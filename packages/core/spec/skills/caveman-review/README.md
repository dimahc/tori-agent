# caveman-review

One-line PR comments. Location, problem, fix. No throat-clearing.

## Description

Generates code review comments in `L<line>: <severity> <problem>. <fix>.` format. One line per finding.

Severity levels:
- 🔴 bug
- 🟡 risk
- 🔵 nit
- ❓ question

Drops "I noticed that...", hedging, and restating what the diff already shows. Keeps exact line numbers, backticked symbols, and concrete fixes.

### Auto-clarity triggers

Drops terse mode for:
- CVE-class security findings (injection, auth bypass, data exposure)
- Architectural disagreements
- Onboarding contexts where the author needs the *why*

Resumes terse mode after the clear part.

Output only — does not approve, request changes, or run linters.

## Usage

```
/caveman-review
```

Also triggers on: "review this PR", "code review", "review the diff".

## Examples

```
L42: 🔴 bug: user can be null after .find(). Add guard before .email.
L88-140: 🔵 nit: 50-line fn does 4 things. Extract validate/normalize/persist.
L23: 🟡 risk: no retry on 429. Wrap in withBackoff(3).
L107: ❓ q: why drop the cache here? Reads on next request will miss.
```

## See also

- [`SKILL.md`](./SKILL.md) — full LLM-facing instructions
- [Caveman README](../../README.md) — repo overview
