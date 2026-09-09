# Changelog

## [Unreleased]

### Added

- Replace delegate tool with native task orchestration
- Add scratchpad tool and update tori orchestration prompts
- Implement lazy-loading for tools
- Add agent reference prompt loading
- Add deny doom loop detection
- Add verify-to-execute transition guard
- Add reviewer agent and reference prompts
- Update agent specs and prompts for references
- Add signing and content_hash verification module
- Add content_hash and signature fields to agent specs
- Verify skill content_hash and signature on load
- Verify agent spec content_hash and signature on load
- Add Universal Skill Format metadata fields
- Add skill install receipts and permission validation
- Validate skill permissions and emit install receipts
- Add Universal Skill Format validation and permission extensions
- Export signing and validation modules
- Implement granular write/edit permissions and path allowlisting
- Add ontology types and schema definitions
- Implement ontology schemas and policy validation
- Implement ontology-driven architecture and policy engine
- Add Tori orchestrator ontology and documentation
- Define agent personas and prompt specifications
- Add scribe ontology capability definitions
- Enhance agent capability and tool resolution
- Align runtime with strict contract
- Enforce bounded cognition authority model
- Add structured_read tool

### Changed

- Update tori prompt requirements qualification protocol
- Optimize tori execution speed and async tool handling
- Clarify agent delegation and tool distinction in tori.md
- Redefine tori orchestration workflow and boundaries
- Specify session naming convention for task tool
- Simplify tori orchestration logic and delegation rules
- Support runtime-specific scratchpad paths
- Update package metadata
- Add security hardening roadmap
- Allow docs directory for ADRs
- Update artifact path references from docs/ to .opencode/
- Mark Phase 2 signing as completed
- Mark Phase 6 Universal Skill Format as completed
- Add execution plans and specifications directories
- Integrate ontology runtime for agent management
- Remove legacy core and cli packages
- Transition compiler and runtime to JSON-LD native processing
- Remove legacy agent specifications and prompt files
- Rename runtime to harness and fix agent registration
- Update plugin export and event logging
- Implement extensive caching for runtime and tool operations
- Refine agent prompts and tool-choice hierarchies

### Fixed

- Allow MCP server tools through agent permission model
- Make subagent delegation actually spawn agents
- Use runtime-aware artifact paths instead of hardcoded .opencode
- Remove unused allCoreTools variable
- Stabilize ontology runtime loading
- Support project-local ontology overrides
- Derive title from first user request
- Enforce strict tori no-mutation
- Enforce strict anti-loop guardrails
- Enforce default session agent binding
- Preserve tori availability
- Fail closed on unbound sessions
- Align plugin with official opencode ABI
- Align workflow_state and bindings
- Harden workflow ontology validation
## [v0.3.1] - 2026-08-08

### Fixed

- Prevent silent failure in skills sync (#16)
## [v0.3.0] - 2026-08-07

### Changed

- Add package metadata to all package.json files
- Improve READMEs for technical clarity
- Add unit tests for core package
- Simplify tori agent and add delivery-agent
- Update workflows to run npm test

### Fixed

- Correct checkbox regex and auto-create workflow in task
## [v0.2.0] - 2026-08-07

### Added

- Add checkNonFunctionalRequirements to verify NFR from briefs (#13)
- Add persona registry, task classification, ADR logging, rollback, CI hooks, feedback events, write guards, and git delivery state (#15)

### Fixed

- Fix auto-assign & npm deps (#14)
- Move specialist permissions to agent level and remove invalid git tool
## [v0.1.3] - 2026-08-06

### Fixed

- Resolve npm OIDC publish 404 and clean up provenance config
## [v0.1.2] - 2026-08-06

### Changed

- Publish via npm OIDC trusted publishing (#11)
- Add prettier config and license fields (#12)
- Use Node 24 in all GitHub Actions workflows

### Fixed

- Set NODE_AUTH_TOKEN on publish step (#10)
- Remove npm auth token
- Add npm publish provenance
## [v0.1.1] - 2026-08-06

### Fixed

- Wire npm token into publish step (#9)
## [v0.1.0] - 2026-08-06

### Added

- Add core package with agent engine, specs, and tools
- Add opencode runtime adapter
- Add kilocode runtime adapter
- Add CLI entrypoint with generate command

### Changed

- Bootstrap npm workspace with root config
- Add git hooks and CI workflows
- Add project documentation

