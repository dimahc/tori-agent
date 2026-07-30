# @tori-agent/cli

CLI package for `tori-agent`.

## Entry point

- `src/index.ts`

## Current status

This package is a **stub**. The planned commands are:

- `tori generate` — scaffold a new agent spec
- `tori serve` — start a local agent server
- `tori doctor` — validate project configuration

None of these are implemented yet. `main()` currently logs `tori-agent CLI — not yet implemented`.

## Scripts

- `npm run build` — compile TypeScript to `dist/`

## Notes

- `package.json` points `bin.tori` to `./dist/cli.js`
- The source entry point is `src/index.ts`
- This package is not part of the production runtime path
