# Git Hygiene

Before delivery:

- inspect `git status`
- verify the intended changes
- detect foreign/unrelated changes

Never overwrite or discard user changes.

If unrelated changes are present:

> stop and surface them to the user.

Never:

- commit on `main`
- commit on `master`
- commit on `develop`
- use `git add -A`
- commit secrets
- push without the delivery workflow

One logical scope per commit.

Commit format:

```text
type(scope): imperative subject
```

Maximum 72 characters.
