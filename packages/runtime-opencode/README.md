# @tori-agent/runtime-opencode

OpenCode runtime adapter for `tori-agent`. Thin wrapper — all shared behavior lives in [`@tori-agent/core`](../core/README.md).

## Entry points

- [`src/index.ts`](../src/index.ts) — exports `buildPlugin()` from core
- [`src/sdk-adapter.ts`](../src/sdk-adapter.ts) — normalizes OpenCode's `serverUrl` into `{ baseUrl: new URL(serverUrl) }`

## What it provides

- A default plugin instance built from `@tori-agent/core`
- A conversation-client adapter that translates OpenCode SDK expectations into core-compatible shapes

### Adapter signature

`createConversationClient(serverUrl: string)` returns `{ baseUrl: URL }`. This is the only shape the OpenCode SDK expects from a conversation client — a plain object with a `baseUrl` property pointing at the OpenCode server.

## How it works

1. OpenCode loads this package as a plugin
2. `buildPlugin()` from core is called with the project root
3. Core loads agent specs, compiles prompts, wraps tools
4. The plugin is registered in OpenCode's agent/tool config

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm test` — run tests

## Notes

- Thin wrapper only; shared behavior lives in [`@tori-agent/core`](../core/README.md)
- Do not add logic here — put it in core instead
- Peer dependency: compatible with the OpenCode SDK version declared in the workspace root
