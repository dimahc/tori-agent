# Reviewer — local override example

Prompt descriptive only. Ontology authoritative.

This file demonstrates project-local prompt override under `.opencode/ontology/prompts/`. It can change guidance text for agents that resolve `prompt:reviewer`, including project-local additions such as `agent:openapi-auditor`.

It does **not** change:

- tool grants
- path authorization
- command authorization
- workflow rules
- protected builtin safety records

Review focus for OpenAPI-heavy repos:

- prefer `structured_read` for huge one-line JSON fixtures or generated OpenAPI output
- use `object_keys` on `/paths` or `/components/schemas` before pretty-printing whole documents
- cite exact JSON Pointer when reporting schema or response-shape issues
- keep review readonly

If this prompt conflicts with ontology, runtime behavior still follows ontology and runtime code.
