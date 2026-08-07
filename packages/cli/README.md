# @tori-agent/cli

CLI for `tori-agent`. Currently implements `generate`; `serve` and `doctor` are pending.

## Commands

### `generate` (implemented)

Expands all agent specs + personas, prints a list of generated files. Outputs to `.opencode/agents/` or `.kilo/agents/` depending on the active runtime. Also syncs builtin skills to `.opencode/skills/` or `.kilo/skills/`.

```bash
node packages/cli/dist/cli.js generate
```

#### Flags

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--format` | `json` (default), `yaml`, `md` | `json` | Output format for agent files. Index is always `index.json`. Builtin skills sync in all formats. |

```bash
# JSON output (default)
node packages/cli/dist/cli.js generate

# YAML output
node packages/cli/dist/cli.js generate --format yaml

# Markdown output
node packages/cli/dist/cli.js generate --format md
```

### `serve` (pending)

Start a local agent server. Not yet implemented.

### `doctor` (pending)

Validate project configuration. Not yet implemented.

## Quickstart

```bash
# Build the CLI
npm run build -w packages/cli

# Generate agent files for the current runtime
node packages/cli/dist/cli.js generate --format yaml
```

## Scripts

- `npm run build` — compile TypeScript to `dist/`

## Notes

- `package.json` points `bin.tori` to `./dist/cli.js`
- Source entry point: `src/index.ts`
- Not part of the production runtime path
- For architecture context, see the [parent README](../README.md)
