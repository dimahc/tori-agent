# Spec completeness checklist

Run through this before promoting a spec past `status: draft`.

## Frontmatter

- [ ] Created via `register_spec` (not by hand) — frontmatter has `title`, `status`, `created`
- [ ] `created` is a valid `YYYY-MM-DD` date
- [ ] `status` reflects reality: `draft` while being written, `active` once adopted
- [ ] Not a stale draft: `check_artifacts` flags drafts untouched for 30+ days — promote or delete

## Content

- [ ] **Context** explains the problem and why now — a newcomer can understand it without asking
- [ ] **Goals** are concrete and verifiable (you could write a test or check for each)
- [ ] **Non-goals** explicitly list what is out of scope
- [ ] **Design** is concrete enough to derive an exec-plan without further questions
- [ ] **Alternatives considered** lists at least one rejected option with a reason, or states why none exist
- [ ] **Open questions** lists unresolved decisions, or explicitly says "none"

## Hygiene

- [ ] One concern per spec — no merged topics
- [ ] Written in English
- [ ] Links to related artifacts use correct relative paths and resolve on disk
- [ ] No duplicated content that lives in another spec/plan — link instead
- [ ] As short as possible while covering the above
