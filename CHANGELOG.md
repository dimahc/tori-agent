# Changelog

## [Unreleased]

### Changed

- Use Node 24 in all GitHub Actions workflows
## [v0.1.2] - 2026-08-06

### Changed

- Publish via npm OIDC trusted publishing (#11)
- Add prettier config and license fields (#12)

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

