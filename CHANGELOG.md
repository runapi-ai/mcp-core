# Changelog

## [v0.2.0](https://github.com/runapi-ai/mcp-core/releases/tag/v0.2.0) - 2026-07-23

### Added
- Expose contract, pricing, validation, response, and task helpers without loading Local configuration or Login capabilities.


## [v0.1.8](https://github.com/runapi-ai/mcp-core/releases/tag/v0.1.8) - 2026-07-22

### Fixed
- Enforce every matching generated input rule while requiring only shared controlling fields.


## [v0.1.7](https://github.com/runapi-ai/mcp-core/releases/tag/v0.1.7) - 2026-07-20

### Changed
- Reject noncanonical task UUIDs before authenticated polling requests and encode valid task path segments.
- Publish and validate nested array and object field constraints in MCP tool schemas.
- Emit JSON Schema minItems and maxItems and enforce model-specific collection limits at runtime.


## [v0.1.6](https://github.com/runapi-ai/mcp-core/releases/tag/v0.1.6) - 2026-07-16

### Changed
- Allow generated input rules to omit required or forbidden field arrays.
- Keep MCP core validation compatible with contract-provided Kling V3 Turbo rules.

## [v0.1.5](https://github.com/runapi-ai/mcp-core/releases/tag/v0.1.5) - 2026-07-08

### Changed
- Publish MCP browser login support, shared RunAPI config handling, and refreshed session behavior.

## [v0.1.4](https://github.com/runapi-ai/mcp-core/releases/tag/v0.1.4) - 2026-06-24

### Changed
- Keep MCP core package metadata and release staging checks aligned with public README requirements.

### Fixed
- Add README documentation to the @runapi.ai/mcp-core npm package so the npm package page renders useful library documentation.

## [v0.1.3](https://github.com/runapi-ai/mcp-core/releases/tag/v0.1.3) - 2026-06-24

### Changed
- Publish the MCP core library with updated package metadata.
- Align the core User-Agent version with the package version.

## [v0.1.2](https://github.com/runapi-ai/mcp-core/releases/tag/v0.1.2) - 2026-06-23

### Changed
- Support per-model divergent-required schemas and hardened the declared enum union so per-model MCP servers advertise a safe union schema and enforce each model's own required fields at request time.

## [v0.1.1](https://github.com/runapi-ai/mcp-core/releases/tag/v0.1.1) - 2026-06-23

### Added
- Support for no-model endpoints: actions whose fields live under the `_` roster now resolve, expose their fields, and reach task creation.

### Fixed
- `fieldsForModel` falls back to the `_` roster; `findModelForAction` returns a no-model result instead of failing; the create body omits `model` when there is none; no-model prices are keyed under `_`.
