# @tori-agent/runtime-kilocode

Kilo Code runtime adapter for `tori-agent`. This is a thin wrapper — all shared behavior lives in `@tori-agent/core`.

## Entry points

- `src/index.ts` — exports `buildPlugin()` from core
- `src/sdk-adapter.ts` — normalizes Kilo Code's `serverUrl` into `{ baseUrl: new URL(serverUrl) }`

## What it provides

- A default plugin instance built from `@tori-agent/core`
- A minimal conversation-client adapter that translates Kilo Code SDK expectations into core-compatible shapes

## How it works

1. Kilo Code loads this package as a plugin
2. `buildPlugin()` from core is called with the project root
3. Core loads agent specs, compiles prompts, wraps tools
4. The plugin is registered in Kilo Code's agent/tool config

## Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm test` — run tests

## Notes

- Thin wrapper only; shared behavior lives in `@tori-agent/core`
- `createConversationClient(serverUrl)` returns `{ baseUrl: new URL(serverUrl) }`
- Do not add logic here — put it in core instead
