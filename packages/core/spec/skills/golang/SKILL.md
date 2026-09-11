---
name: golang
description: Idiomatic Go engineering, review, and design guidance based on the official Go Code Review Comments and Google's Go Style Guide, Best Practices, Guide, and Decisions.
license: CC BY 4.0
compatibility: "Requires Go. Optional: gofmt, goimports, golangci-lint."
metadata:
  version: "1.0.1"
  spec: https://google.github.io/styleguide/go/
  source: https://go.dev/wiki/CodeReviewComments
---

# Go

Use this skill whenever writing, reviewing, refactoring, designing, or testing Go code.

## Sources

This skill is derived from:

- Go Code Review Comments: https://go.dev/wiki/CodeReviewComments
- Google Go Style Guide (index): https://google.github.io/styleguide/go
- Google Go Style Guide — Guide: https://google.github.io/styleguide/go/guide
- Google Go Style Guide — Decisions: https://google.github.io/styleguide/go/decisions
- Google Go Style Guide — Best Practices: https://google.github.io/styleguide/go/best-practices

The official Go guidance has priority over local stylistic preferences. Google's guide is especially useful for code-quality and large-codebase conventions, but project-local conventions may override it when explicitly established.

### Document hierarchy

The Google Go Style Guide ecosystem has three documents with different authority levels:

- **Style Guide** (`guide`) — Canonical and normative. The definitive foundation. All code (old and new) should follow this. Short and prescriptive.
- **Style Decisions** (`decisions`) — Normative only. More verbose. Explains reasoning behind specific style decisions. May change over time. Reviewers use it as reference; authors are not expected to know it.
- **Best Practices** (`best-practices`) — Neither canonical nor normative. Patterns evolved over time. Not mandatory but encouraged to keep the codebase uniform.

The Google Style Guide assumes familiarity with [Effective Go](https://go.dev/doc/effective_go) as a common baseline for Go code across the community.

## Definitions

Key terms used throughout this skill and the Google Go Style Guide:

- **Canonical**: Prescriptive and enduring rules. A standard that all code should follow and is not expected to change substantially. Canonical documents are shorter and prescribe fewer elements of style. They meet a high bar.
- **Normative**: Agreed-upon elements of style for Go code reviewers, to keep suggestions, terminology, and justifications consistent. Normative elements may change over time. Authors are not expected to be familiar with normative documents, but reviewers use them as reference.
- **Idiomatic**: Common and familiar patterns in Go code. An idiomatic pattern should be preferred over something unidiomatic if both serve the same purpose in context, as it will be the most familiar to readers.

## Core principles

- Prefer simple, idiomatic Go over clever abstractions.
- Make the normal execution path obvious.
- Keep APIs small and concrete.
- Prefer composition over inheritance-like abstractions.
- Introduce abstractions only when there is a demonstrated need.
- Prefer standard-library solutions when they are sufficient.
- Optimize for readability and maintainability before micro-optimizing.
- Make ownership, lifecycle, cancellation, and error behavior explicit.
- Avoid speculative interfaces, wrappers, helpers, and layers.
- Keep changes focused; do not refactor unrelated code merely because it could be improved.

## Philosophy

These documents intend to:

- Agree on a set of principles for weighing alternate styles
- Codify settled matters of Go style
- Document and provide canonical examples for Go idioms
- Document the pros and cons of various style decisions
- Help minimize surprises in Go readability reviews
- Help reviewers use consistent terminology and guidance

These documents do **not** intend to:

- Be an exhaustive list of comments that can be given in a readability review
- List all of the rules everyone is expected to remember and follow at all times
- Replace good judgment in the use of language features and style
- Justify large-scale changes to get rid of style differences

It suffices to write new code using the latest best practices and address nearby issues over time. Do not nit-pick every violation of the Style Guide. Style recommendations will not be changed without due discourse — follow the style guide even where you might disagree, as uniformity provides significant value.

## Formatting and tooling

Before considering Go code complete:

- Run `gofmt` on changed Go files.
- Prefer `goimports` when available to maintain imports automatically.
- Run `go vet` where appropriate.
- Run relevant tests with `go test`.
- For race-sensitive concurrent code, use `go test -race`.
- Use project-configured linters rather than inventing ad-hoc style rules.
- Do not manually format code in a way that fights `gofmt`.

There is no arbitrary line-length limit. Break lines according to semantics and readability, not a column count.

## Naming

Follow Go naming conventions:

- Use MixedCaps rather than underscores.
- Use short local variable names when their scope is small.
- Make names more descriptive as their scope and lifetime increase.
- Use short, consistent receiver names, usually one or two letters.
- Do not use `this` or `self` for receivers.
- Preserve initialisms: `ID`, `URL`, `HTTP`, `API`, `JSON`, `SQL`, etc.
- Prefer `userID`, `httpClient`, `parseURL`, `ServeHTTP`.
- Avoid meaningless package names such as `util`, `common`, `misc`, `types`, and `interfaces`.
- Do not repeat the package name in exported identifiers: prefer `http.Client` over `http.HTTPClient`.
- Choose names that communicate semantics rather than implementation details.

## Packages

- Keep package responsibilities cohesive.
- Prefer focused packages with clear ownership.
- Avoid package dependency cycles.
- Avoid generic catch-all packages.
- Keep package APIs intentionally small.
- Put interfaces in the consuming package when an interface is actually needed.
- Return concrete types from implementing packages unless an abstraction is genuinely part of the API contract.
- Do not create interfaces solely to make mocking easier.
- Do not define an interface before there is a real consumer need for it.

## Functions and APIs

- Keep functions focused and easy to reason about.
- Prefer synchronous functions unless asynchronous behavior is intrinsic to the API.
- Avoid unnecessary parameters and result values.
- Avoid named return values unless they materially improve API clarity or are required by deferred mutation.
- Avoid naked returns in medium or large functions.
- Prefer explicit return values when they make control flow clearer.
- Do not use pointer parameters merely to avoid copying small values.
- Use pointers when mutation, identity, ownership, or meaningful size makes them appropriate.
- Do not return pointers to interfaces.
- Prefer concrete values when the type naturally has value semantics.

## Error handling

Errors are part of the API contract.

- Check returned errors.
- Do not silently discard errors with `_` unless there is a deliberate, documented reason.
- Return errors to the caller when the current layer cannot handle them.
- Handle errors at the layer that has enough context to act on them.
- Keep normal control flow minimally indented by handling errors early.
- Wrap errors when additional context is useful.
- Preserve the underlying error for inspection with `errors.Is` / `errors.As` when appropriate.
- Do not turn ordinary expected failures into panics.
- Do not use panic for normal error handling.
- Error strings should normally be lowercase and should not end with punctuation.
- Avoid redundant error prefixes that merely repeat the function or package name.
- Do not use sentinel errors when a typed error or wrapping provides a better contract; likewise, do not introduce custom error types without a real need.

Example:

```go
data, err := load(ctx)
if err != nil {
	return fmt.Errorf("load configuration: %w", err)
}

// normal path
```

## Context

Use `context.Context` deliberately.

- Pass context explicitly.
- For request-scoped operations, context should normally be the first parameter.
- Do not store `context.Context` in a struct.
- Do not create custom context types.
- Do not use context as a general-purpose parameter bag.
- Use `context.Background()` only when there is a genuine root/background operation.
- Propagate cancellation and deadlines to downstream operations that support context.
- Do not create a new unrelated context merely to satisfy an API.

Example:

```go
func (s *Service) Get(ctx context.Context, id string) (Item, error) {
	return s.store.Get(ctx, id)
}
```

## Goroutines and concurrency

Concurrency is an explicit design concern.

- Prefer synchronous APIs unless concurrency is required.
- Every goroutine must have an understandable lifetime.
- Know how and when each goroutine exits.
- Ensure blocked channel operations can eventually unblock.
- Propagate cancellation through `context.Context` where appropriate.
- Avoid goroutine leaks.
- Do not close channels from the receiver side unless ownership is explicit.
- The sender that owns a channel should generally be responsible for closing it.
- Prefer simple concurrency structures over clever coordination.
- Use synchronization primitives consistently and avoid copying types containing `sync.Mutex` or similar state.
- Do not assume concurrent access is safe merely because a type is a pointer.
- Run the race detector when concurrency behavior warrants it.

## Channels

Use channels for communication and coordination, not as a default replacement for every synchronization mechanism.

Prefer:

```go
jobs := make(chan Job)

go func() {
	defer close(jobs)
	// produce jobs
}()
```

over designs where ownership of channel closure is ambiguous.

If a mutex expresses the problem more directly than a channel, use a mutex.

## Slices and maps

- Prefer nil slices when an empty slice is sufficient.
- Use non-nil empty slices when the API or serialization contract requires `[]` rather than `null`.
- Do not make APIs depend unnecessarily on the distinction between nil and empty slices.
- Remember that slices and maps are reference-like descriptors; copying them does not copy their backing storage.
- Do not assume copying a struct is safe when it contains slices, maps, pointers, mutexes, buffers, or other mutable state.
- Initialize maps before writing to them when necessary.
- Prefer clear map access using the `value, ok` form when absence matters.
- Avoid in-band sentinel values when a second return value or error communicates failure more reliably.

## Structs and receivers

Choose receiver types intentionally.

Use pointer receivers when:

- the method mutates the receiver;
- the struct is large;
- the struct contains synchronization primitives;
- identity or shared mutable state matters;
- copying would be surprising or unsafe.

Use value receivers for small, immutable, value-like types where copying is natural.

Do not mix pointer and value receivers arbitrarily on the same type. Consistency matters.

Do not copy types containing synchronization primitives.

## Interfaces

Interfaces should describe behavior required by a consumer.

Prefer:

```go
type Store interface {
	Get(ctx context.Context, id string) (Item, error)
}
```

in the package that consumes the behavior, when an abstraction is actually required.

Avoid:

```go
type Store interface {
	// mirrors every method of the concrete implementation
}
```

created solely for mocking.

Prefer testing real implementations through public behavior when practical. Use small fakes or test doubles at the consumer boundary when they make tests clearer.

## Documentation and comments

- Exported declarations should have useful documentation.
- Doc comments should begin with the name of the declaration.
- Write complete sentences for API documentation.
- Comments should explain why, constraints, invariants, or non-obvious behavior—not restate obvious code.
- Keep comments accurate as code evolves.
- Prefer fixing unclear code over adding comments that explain unnecessarily complicated code.

Example:

```go
// Client manages requests to the Pet API.
type Client struct {
	// ...
}
```

## Imports

- Group standard-library imports separately from third-party imports.
- Prefer `goimports`.
- Avoid import aliases unless there is a collision or another compelling reason.
- Do not use dot imports in production code.
- Side-effect imports should be limited to legitimate initialization use cases, typically in `main` or tests.

## Control flow

- Keep the happy path at low indentation.
- Return or continue immediately after handling an error.
- Avoid unnecessary `else` blocks after a terminating branch.
- Prefer straightforward control flow over clever expressions.
- Use `switch` when it communicates a multi-way decision more clearly than nested `if` statements.
- Avoid deeply nested conditionals; extract a meaningful function only when that improves the model of the code, not merely to shorten it.

## Initialization

- Keep initialization simple.
- Prefer explicit construction when it makes dependencies visible.
- Avoid global mutable state.
- Do not hide significant work inside package initialization.
- Use constructors when invariants or dependency wiring require them, not automatically for every struct.
- A zero value should be useful when that is natural and practical.

## Generics

Use generics when they express a real reusable abstraction.

- Do not use generics merely because they are available.
- Prefer ordinary functions and concrete types when they are clearer.
- Avoid generic abstractions that obscure domain semantics.
- Keep type constraints as simple as practical.
- Do not introduce a generic helper for a single call site unless it materially improves correctness or clarity.

## Reflection

Avoid reflection unless the problem genuinely requires runtime type inspection or dynamic behavior.

Prefer:

- concrete types;
- interfaces;
- generics;
- explicit conversion;
- standard-library mechanisms.

Reflection should not be used to compensate for an unnecessarily abstract design.

## JSON, APIs, and serialization

- Treat serialized structures as API contracts.
- Choose nil vs empty slices deliberately when JSON behavior matters.
- Use explicit JSON tags when the wire format requires them.
- Do not change serialized field names casually.
- Avoid leaking internal implementation structures directly into public API contracts.
- Validate external input at boundaries.
- Keep transport concerns separate from domain semantics when the complexity warrants it.

## Security

- Use `crypto/rand` for security-sensitive randomness.
- Never use `math/rand` or `math/rand/v2` for keys, tokens, secrets, or security-sensitive identifiers.
- Validate and constrain untrusted input.
- Avoid logging secrets, credentials, tokens, or sensitive payloads.
- Propagate deadlines and cancellation to prevent resource exhaustion.
- Be explicit about filesystem, network, and subprocess boundaries.
- Prefer safe standard-library APIs over manual parsing or escaping.

## Testing

Tests are production-quality code.

Prefer tests that:

- exercise behavior rather than implementation details;
- are deterministic;
- clearly state the input, actual result, and expected result;
- use table-driven tests when multiple cases share the same structure;
- keep setup proportional to the behavior being tested;
- test error behavior and boundary cases;
- use `t.Helper()` for reusable test helpers;
- use subtests when case names materially improve diagnosis.

A useful failure looks like:

```go
if got != want {
	t.Errorf("Parse(%q) = %v; want %v", input, got, want)
}
```

Do not write assertions whose failure messages force the next developer to reproduce the failure to understand it.

When adding a package, consider adding a runnable `Example` when it communicates intended usage better than prose.

## Benchmarks and performance

- Do not optimize without evidence.
- Benchmark before and after performance-sensitive changes.
- Prefer profiling to intuition.
- Avoid allocations only when they materially affect the workload.
- Do not use pointer receivers or pointers solely as speculative performance optimizations.
- Keep performance optimizations local and measurable.

## Logging

- Log at meaningful boundaries rather than every function call.
- Do not duplicate the same error context at every layer.
- Include identifiers and operation context when useful.
- Do not log secrets or sensitive data.
- Prefer structured logging when the project uses it.
- Keep errors and logs distinct: an error returned to a caller does not need to be formatted like a complete log line.

## Generated code

- Respect generated-code conventions.
- Do not manually edit generated files unless the generation workflow explicitly permits it.
- Human-written code should follow the normal style rules even when generated code does not.

## Review checklist

When reviewing Go code, check in this order:

### Correctness

- Does the code do what the API/domain requires?
- Are errors handled?
- Are edge cases covered?
- Are nil, zero values, and empty collections handled intentionally?
- Are resources closed or released?
- Are cancellation and deadlines propagated?

### Concurrency

- Can goroutines leak?
- Is channel ownership clear?
- Can there be data races?
- Are synchronization primitives copied?
- Is concurrency actually necessary?

### API design

- Are interfaces necessary?
- Are they defined at the consumer boundary?
- Are concrete types returned where appropriate?
- Are pointer/value semantics intentional?
- Are context and errors part of the correct API contract?

### Readability

- Is the happy path easy to follow?
- Are names idiomatic?
- Are comments useful?
- Is the code more abstract than necessary?
- Is there unnecessary indirection?

### Maintainability

- Does the change introduce speculative abstractions?
- Does it duplicate domain concepts?
- Does it create generic utility packages without a clear owner?
- Does it make future changes easier or harder?

### Tests

- Do tests verify behavior?
- Are failures diagnostic?
- Are important error paths covered?
- Are tests deterministic?
- Is the race detector relevant?

### Tooling

- Is `gofmt` clean?
- Are imports clean?
- Does `go vet` pass where applicable?
- Do relevant tests pass?
- Do configured linters pass?

## Anti-patterns to flag

Flag these unless there is a concrete justification:

- Interfaces created only for mocking.
- `context.Context` stored in structs.
- `context.Background()` used where request context should be propagated.
- Ignored errors.
- Panic for ordinary error handling.
- Goroutines without an obvious shutdown path.
- Unbounded goroutine creation.
- Pointer parameters used only to avoid copying small values.
- Pointer-to-interface parameters or fields.
- `this` / `self` receiver names.
- Incorrect initialism casing such as `Id`, `Url`, `Http`.
- `util`, `common`, `misc`, `types`, or `interfaces` catch-all packages.
- Dot imports in production code.
- Arbitrary line wrapping.
- Long functions whose complexity should instead be reduced semantically.
- Generic abstractions with no real reuse.
- Reflection where ordinary Go constructs suffice.
- Global mutable state.
- Security-sensitive randomness from `math/rand`.
- Error messages with capitalization or trailing punctuation.
- Comments that merely restate code.
- Closing a channel when channel ownership is unclear.
- Concurrent code whose goroutine lifetime cannot be explained.

## Decision rule

When several valid implementations exist, prefer the one that:

1. has the smallest conceptual surface;
2. uses standard Go idioms;
3. keeps dependencies and ownership obvious;
4. makes failure and cancellation behavior explicit;
5. avoids speculative abstractions;
6. is easy to test through its public behavior;
7. can be understood without reading unrelated packages.

Do not apply a style rule mechanically when it conflicts with correctness, an established project convention, or a clearer API.

## Agent behavior

When modifying a Go repository:

1. Inspect existing project conventions before introducing new ones.
2. Search for existing patterns before creating helpers, interfaces, errors, or abstractions.
3. Make the smallest coherent change.
4. Format changed Go files.
5. Run focused tests first, then broader tests when practical.
6. Run relevant static checks.
7. Review the final diff for accidental complexity and unrelated changes.
8. Report verification performed and any checks that could not be run.

When reviewing code, distinguish:

- **must fix**: correctness, security, data race, lifecycle, broken API contract, or clear violation of established project requirements;
- **should fix**: significant readability, maintainability, or idiomatic Go issue;
- **nit**: optional stylistic preference.

Do not block a change over subjective style when the code is already clear and consistent with the repository.

## Additional references

These resources provide further context and may be cited in reviews:

- [Effective Go](https://go.dev/doc/effective_go) — common baseline for Go code
- [Go Language Specification](https://go.dev/ref/spec) — authoritative language definition
- [Go FAQ](https://go.dev/doc/faq) — frequently asked questions
- [Go Memory Model](https://go.dev/ref/mem) — memory ordering guarantees
- [Go Data Structures](https://research.swtch.com/godata) — data structure guidance
- [Go Interfaces](https://research.swtch.com/interfaces) — interface design
- [Go Proverbs](https://go-proverbs.github.io/) — Rob Pike's principles
- [Testing on the Toilet](https://testing.googleblog.com/) — Google testing articles (identifier naming, testing state vs interactions, effective testing, risk-driven testing)
- [Go and Dogma](https://research.swtch.com/dogma) — on dogmatism in Go
- [Less is exponentially more](https://commandcenter.blogspot.com/2012/06/less-is-exponentially-more.html) — on simplicity

## Source precedence

For disputes:

1. Go language/compiler/tooling behavior.
2. Official Go documentation and `go.dev` guidance.
3. Explicit repository-local conventions and requirements.
4. Google Go Style Guide and its best practices/decisions.
5. Personal preference.

The Google guide contains decisions intended for Google's codebase and may be stricter than necessary for every project. Apply its principles where they improve consistency and quality without blindly importing organization-specific constraints.
