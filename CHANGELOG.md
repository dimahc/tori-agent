# Changelog

## [Unreleased]

### Changed

- Update CHANGELOG.md
- Update CHANGELOG.md
- Orchestrate pipeline via workflow_call

### Fixed

- Grant packages write to pipeline permissions
- Drop concurrency from reusable workflows
## [v0.2.4] - 2026-08-06

### Added

- Sync package versions from release tag

### Fixed

- Remove stale workflow_run event guards (#7)
- Push changelog from detached HEAD
## [v0.2.3] - 2026-08-06

### Added

- Chain workflows via workflow_run (#6)
## [v0.2.2] - 2026-08-06

### Changed

- Update CHANGELOG.md

### Fixed

- Publish via trusted publishing
## [v0.2.1] - 2026-08-05

### Added

- Add deliberation-loop detection (#5)

### Changed

- Update CHANGELOG.md
- Update CHANGELOG.md

### Fixed

- Run jobs on tag
- Repair publish auth, triggers, changelog commit (#4)
## [v0.2.0] - 2026-08-04

### Added

- Grant specialists plan-awareness tools
- Auto-bind workflow tasks to exec-plan blocks
- Strengthen specialist prompt for plan adherence
- Require exec-plan context in all complex delegations
- Add write_append tool for incremental long-content generation
- Add save_checkpoint tool for context limit recovery
- Preserve important lines in truncateOutput
- Add security, changelog, and release workflows
- Switch changelog workflow to git-cliff-action

### Changed

- Bump version to 0.2.0 for release
- Fix release workflow and clean up CI comments
- Fix NPM_TOKEN conditional syntax in release workflow
- Update CHANGELOG.md
- Update tags pattern

### Fixed

- Sync builtin skills on init and expose skill tool
- Remove cancel-in-progress to prevent workflow cancellation
- Resolve workflow failures and enforce execution order
- Use valid glob pattern for release tag trigger
- Use valid string value for sort_commits in cliff.toml
- Update node brace-expansion dep
- Use NPM_SECRET from npm environment for publish
- Add id-token write permission for npm provenance
- Add package-manager-cache: false to publish setup
- Rename NODE_AUTH_TOKEN to NPM_SECRET
## [v0.1.0] - 2026-07-31

### Added

- Initial team-lead orchestrator plugin for opencode
- Add opencode-dynamic-context-pruning (DCP) support
- User-customizable agent config and project docs
- Add review-manager agent for multi-perspective code reviews
- Add context management guidance and improve scratchpad granularity for compaction resilience
- Add dedicated reviewer agents and risk-based review protocol
- Add beta release support to CI
- Add persistent memory across sessions
- Add bug-finder agent for structured bug investigation
- Rewrite review-manager and reviewers for speed and anti-leniency
- Prefer registered user-defined agents over invented personas
- Add interactive workflow diagram artifact
- Add FR/EN language switching to intro screen
- Extend FR/EN i18n to flowchart SVG and detail panel
- Add Configuration page documenting all configurable options
- Add soul/personality card to Concept & philosophie section
- Register harness, planning, gardener agents; deprecate memory.md
- Harness agent now fully autonomous with CI-system detection and context-aware PR logic
- Add brainstorm agent (#6)
- Add lifecycle tools, fix execute return type, add test suite
- Add doc-inspector agent and doc_* tools for autonomous doc inspection
- Add write permission on .opencode/scratchpad.md for team-lead agent
- New interactive flowchart docs with React Flow (public-docs/)
- Phase drill-down — click a phase card to explore its detailed workflow
- Zigzag 2-column layout for phase overview
- Add researcher agent for external knowledge research
- Add spec-writer skill bundled with plugin
- Grant review-manager direct read access; update changelog
- Allow Orion and review-manager to read files directly for coordination
- Allow Orion to run ls, head, and echo directly via bash
- Add vitepress-plugin-llms for LLM-friendly docs
- Add llms.txt link in sidebar and head discovery hint
- Replace legacy React apps with VitePress documentation portal
- Add Gardener Protocol to Orion's prompt
- Formalize brainstorm/planning orchestration workflow
- Tori-agent stack implementation (#1)
- Add GitHub Actions CI/CD pipeline (#3)

### Changed

- Switch installation to npm package reference
- Add npm publish workflow on GitHub release
- Trigger on tag push and auto-create GitHub release
- Add OIDC provenance and public access to npm publish
- Switch to OIDC trusted publishing (no npm token needed)
- Enforce inline git commit to avoid editor crash in non-interactive shell
- Enforce inline git tag -a -m to avoid editor crash
- Update changelog for deep merge and reviewer agents
- Update changelog for requirements-reviewer cap fix
- Add beta installation instructions to README
- Remove sequential-thinking tool from all agents
- Fix file count and table in AGENTS.md (7 → 10)
- Trim stale scaffolding from prompt.md
- Remove over-specified scaffolding from prompt.md
- Update README for persistent memory feature
- Translate soul directives from French to English
- Add CHANGELOG entry for soul translation to English
- Update AGENTS.md — bug-finder, third hook, stale sections, references
- Move agent prompts to agents/ subdirectory
- Add review-manager optimization and anti-leniency to CHANGELOG
- Create IDEAS.md to track future architectural directions
- Add QA Runtime Loop concept to IDEAS.md with cost caveats
- Data-driven agent registration in index.js
- Exclude .parcel-cache from git tracking
- Add GitHub Pages deployment workflow for workflow diagram
- Document website artifact maintenance in AGENTS.md
- Deep update AGENTS.md, architecture.md, README; add missing agent specs
- Update documentation and add orion-docs website
- Document brainstorm agent (Phase 0) in orion-docs (#7)
- Track .opencode/agents/ and .opencode/tools/ in git
- Remove orion-docs/ legacy directory and expand Phase 0 brainstorm flowchart (#9)
- Remove spec-writer entry from changelog
- Tighten agent permissions and add session.created dir init
- Add .gitignore to exclude build artifacts and cache
- Add workflow_dispatch for beta releases with auto version resolution
- Fix --create-tag not supported, use git tag + git push instead
- Fix double-v prefix in tag by using resolve output directly
- Fix stale docs, align specs to code, clean zombie permissions
- Replace all Orion references with team-lead

### Fixed

- Add --allow-same-version to npm version
- Upgrade npm for OIDC trusted publishing support
- Use Node 24 for native npm OIDC support
- Write clean .npmrc without _authToken for OIDC
- Enable scratchpad read/write and reinforce usage in workflow
- Enforce review-manager delegation in team-lead prompt
- Deep merge permissions and track task_id in scratchpad
- Requirements-reviewer additive to cap, restore technical coverage
- Use CHANGELOG [Unreleased] section as beta pre-release notes
- Remove stray backslash causing syntax error in index.js
- Correct brainstorm agent permission key, read format, and silent flag
- Harness no longer writes human checklists to AGENTS.md
- Resolve plugin portability issues for other users' machines
- Center flowchart SVG and improve navigation controls
- Clean up flowchart visual issues
- Horizontal edge routing + visible colored arrows in overview
- Larger text in phase cards and cleaner edge routing
- Increase vertical spacing between phase cards — no more overlap
- Restore planning agent read/glob/grep permissions
- Replace invalid write permission key with edit across all agents
- Allow docs edits and simplify git permissions
- Brainstorm agent can now create brief files (add write permission on docs/briefs/**)
- Planning agent can now create exec-plan files (add write permission on docs/exec-plans/**)
- Ensure clean-checkout builds emit dist types (#2)

### Harness

- Encode recurring patterns as mechanical enforcement artifacts

### Release

- V0.3.0
- V0.6.0
- V0.6.1
- V0.6.2
- V0.7.0
- V0.8.0
- V0.9.0

### Remove

- Drop memoai integration (#1)

