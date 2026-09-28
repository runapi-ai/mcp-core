# Changelog

## [v0.4.5](https://github.com/runapi-ai/mcp-core/releases/tag/v0.4.5) - 2026-09-28

### Fixed
- Accept declared union field types and preserve arbitrary keys in explicitly open object inputs.


## [v0.4.4](https://github.com/runapi-ai/mcp-core/releases/tag/v0.4.4) - 2026-09-16

### Added
- Let a model server route a tool's create and status calls to the action's published public path, so a capability that lives outside its model line is addressed correctly.


## [v0.4.3](https://github.com/runapi-ai/mcp-core/releases/tag/v0.4.3) - 2026-09-04

### Changed
- Add the generated hybrid lifecycle operation marker to the public MCP contract type.


## [v0.4.2](https://github.com/runapi-ai/mcp-core/releases/tag/v0.4.2) - 2026-08-21

### Fixed
- Count Unicode code points when enforcing RunAPI string-length constraints.


## [v0.4.1](https://github.com/runapi-ai/mcp-core/releases/tag/v0.4.1) - 2026-08-17

### Fixed
- Count Unicode code points when enforcing RunAPI string-length constraints.


## [v0.4.0](https://github.com/runapi-ai/mcp-core/releases/tag/v0.4.0) - 2026-08-14

### Removed
- Remove the aggregate catalog_models field from the shared MCP contract types.
  Migration: Discover aggregate models through actions[].models and resolve their fields through fields_by_model.


## [v0.3.0](https://github.com/runapi-ai/mcp-core/releases/tag/v0.3.0) - 2026-08-07

### Added
- Validate presence conditions, required-any fields, and conditional enum constraints from RunAPI contracts.


## [v0.2.3](https://github.com/runapi-ai/mcp-core/releases/tag/v0.2.3) - 2026-07-31

### Changed
- Resolve MCP prices from the RunAPI Price Schedule API instead of embedded package data.

### Fixed
- Return the documented pricing-unavailable result when a runtime pricing request does not respond.


## [v0.2.2](https://github.com/runapi-ai/mcp-core/releases/tag/v0.2.2) - 2026-07-28

### Added
- Add public Price Schedule and Price Quote clients with shared runtime lookup error handling for MCP package authors.


## [v0.2.1](https://github.com/runapi-ai/mcp-core/releases/tag/v0.2.1) - 2026-07-23

### Added
- Let RunApiClient task creation calls send an optional caller-provided Idempotency-Key header without adding it to the JSON body.


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
