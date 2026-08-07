# Changelog

## [Unreleased]

### Added

- Add checkNonFunctionalRequirements to verify NFR from briefs (#13)
- Add persona registry, task classification, ADR logging, rollback, CI hooks, feedback events, write guards, and git delivery state (#15)

### Fixed

- Fix auto-assign & npm deps (#14)
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

