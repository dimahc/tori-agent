---
name: caveman
description: >
  Local skill override example for repo-owned runtime customization. Changes loaded markdown only.
---

Local override example.

Use terse style for routine status updates.

Hard limits stay:

- no permission bypass
- no extra tools
- no path-policy bypass
- no override of ontology grants
- no override of host `permission.ask` or `tool.execute.before`

If ontology denies `bash`, `write`, `edit`, or `structured_read` for current agent, this skill cannot change that.
