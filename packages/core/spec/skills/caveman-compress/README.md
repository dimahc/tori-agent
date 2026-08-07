# caveman-compress

Shrink memory files. Save tokens every session.

## Description

Compresses project memory files (`CLAUDE.md`, todos, preferences) into caveman-style prose. Claude reads `CLAUDE.md` on every session start — a large file costs tokens every time. Compression reduces that overhead permanently.

Original files are preserved as `.original.md` backups. Re-run the skill after edits to re-compress.

**Measured savings:** ~46% average token reduction on real project files, with all headings, code blocks, URLs, and file paths preserved exactly.

## Usage

```
/caveman-compress <filepath>
```

Examples:

```
/caveman-compress CLAUDE.md
/caveman-compress docs/preferences.md
/caveman-compress todos.md
```

### Supported file types

| Type | Compress? |
|------|-----------|
| `.md`, `.txt`, `.rst`, `.typ`, `.typst`, `.tex` | Yes |
| Extensionless natural language | Yes |
| `.py`, `.js`, `.ts`, `.json`, `.yaml` | No (code/config) |
| `*.original.md` | No (backup files) |

Requires Python 3.10+.

## Flow

```
/caveman-compress CLAUDE.md
        ↓
detect file type        (no tokens)
        ↓
Claude compresses       (tokens — one call)
        ↓
validate output         (no tokens)
  checks: headings, code blocks, URLs, file paths, bullets
        ↓
if errors: Claude fixes cherry-picked issues only   (tokens — targeted fix)
  does NOT recompress — only patches broken parts
        ↓
retry up to 2 times
        ↓
write compressed → CLAUDE.md
write original   → CLAUDE.original.md
```

Only two steps use tokens: initial compression + targeted fix if validation fails. Everything else is local Python.

## Benchmarks

Real results on real project files:

| File | Original | Compressed | Saved |
|------|----------:|----------:|------:|
| `claude-md-preferences.md` | 706 | 285 | 59.6% |
| `project-notes.md` | 1145 | 535 | 53.3% |
| `claude-md-project.md` | 1122 | 636 | 43.3% |
| `todo-list.md` | 627 | 388 | 38.1% |
| `mixed-with-code.md` | 888 | 560 | 36.9% |
| **Average** | **898** | **481** | **46%** |

All validations passed — headings, code blocks, URLs, file paths preserved exactly.

## Preservation list

Caveman-compress only touches natural language prose. It never modifies:

- Code blocks (fenced or indented)
- Inline code (backtick content)
- URLs and links
- File paths (`/src/components/...`)
- Commands (`npm install`, `git commit`)
- Technical terms, library names, API names
- Headings (exact text preserved)
- Tables (structure preserved, cell text compressed)
- Dates, version numbers, numeric values

## Security note

Flagged as Snyk High Risk due to subprocess and file I/O patterns. This is a false positive — see [`SECURITY.md`](./SECURITY.md) for details.

## See also

- [`SKILL.md`](./SKILL.md) — full LLM-facing instructions
- [Caveman README](../../README.md) — repo overview, install, benchmarks
