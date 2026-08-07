# @tori-agent/runtime-kilocode

Kilo Code runtime adapter for `tori-agent`. Thin wrapper — all shared behavior lives in [`@tori-agent/core`](../core/README.md).

## Entry points

- [`src/index.ts`](../src/index.ts) — exports `buildPlugin()` from core
- [`src/sdk-adapter.ts`](../src/sdk-adapter.ts) — normalizes Kilo Code's `serverUrl` into `{ baseUrl: new URL(serverUrl) }`

## What it provides

- A default plugin instance built from `@tori-agent/core`
- A conversation-client adapter that translates Kilo Code SDK expectations into core-compatible shapes

### Adapter signature

`createConversationClient(serverUrl: string)` returns `{ baseUrl: URL }`. This is the only shape the Kilo Code SDK expects from a conversation client — a plain object with a `baseUrl` property pointing at the Kilo Code server.

## Kilo Code-specific notes

The adapter is structurally identical to the OpenCode adapter. The only difference is the host SDK it targets. If the adapters diverge (e.g., Kilo Code requires additional SDK shapes), those differences belong here, not in core.

## How it works

1. Kilo Code loads this package as a plugin
2. `buildPlugin()` from core is called with the project root
3. Core loads agent specs, compiles prompts, wraps tools
4. The plugin is registered in Kilo Code's agent/tool config

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm test` — run tests

## Notes

- Thin wrapper only; shared behavior lives in [`@tori-agent/core`](../core/README.md)
- Do not add logic here — put it in core instead
- Peer dependency: compatible with the Kilo Code SDK version declared in the workspace root
