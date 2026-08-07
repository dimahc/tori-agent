# caveman

Compress model responses to caveman-style prose. Same brain, fewer tokens.

## Description

Drops articles, filler, pleasantries, and hedging from every model response. Keeps every technical detail, code block, error string, and symbol exact. Measured savings: ~65% output token reduction with full accuracy preserved. Mode persists for the whole session until changed or stopped.

### Intensity levels

| Level | Behavior |
|-------|----------|
| `lite` | Drop filler/hedging. Sentences stay full. Professional but tight. |
| `full` | Default. Drop articles, fragments OK, short synonyms. |
| `ultra` | Bare fragments. Abbreviations (DB, auth, fn). Arrows for causality. |
| `wenyan-lite` | Classical Chinese register, light compression. |
| `wenyan-full` | Maximum 文言文. 80–90% character reduction. |
| `wenyan-ultra` | Extreme classical compression. |

### Auto-clarity rule

Caveman drops to normal prose for:
- Security warnings
- Irreversible-action confirmations
- Multi-step sequences where fragment ambiguity risks misread
- When user repeats a question

Resumes compressed mode after the clear part.

## Usage

```
/caveman              # full mode (default)
/caveman lite         # lighter compression
/caveman ultra        # extreme compression
/caveman wenyan       # classical Chinese
stop caveman          # back to normal prose
```

## Examples

Question: "Why does my React component re-render?"

Normal prose:
> Your component re-renders because you create a new object reference each render. Wrapping it in `useMemo` will fix the issue.

Caveman (full):
> New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`.

Caveman (ultra):
> Inline obj prop → new ref → re-render. `useMemo`.

## See also

- [`SKILL.md`](./SKILL.md) — full LLM-facing instructions
- [Caveman README](../../README.md) — repo overview, install, benchmarks
