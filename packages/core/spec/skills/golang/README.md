# Golang Skill

Go style guide and best practices for writing idiomatic, readable, maintainable Go code.

## Overview

This skill provides a comprehensive guide to Go style based on two authoritative sources:

- **[Go Code Review Comments](https://go.dev/wiki/CodeReviewComments)** — the Go Wiki's collection of common code review comments, covering formatting, naming, error handling, concurrency, and more.
- **[Google Go Style Guide](https://google.github.io/styleguide/go/)** — Google's normative style decisions for Go code, organized into Guide, Decisions, and Best Practices documents.

Use this skill when writing, reviewing, or refactoring Go code. It is especially useful for code reviews, onboarding new Go developers, and establishing team style conventions.

## Key Principles

| Principle | Description |
|-----------|-------------|
| **Clarity** | Code should be easy to understand. Choose the style that makes the code clearer when there is a choice between two options. |
| **Simplicity** | Code should be simple. Avoid clever tricks and unnecessary complexity. Favor straightforward solutions. |
| **Concision** | Code should be concise. Use short names for short-scope variables and longer names for things with wider reach. |
| **Maintainability** | Code should be maintainable. Easy to update and extend over time. Avoid patterns that are difficult to modify. |
| **Consistency** | Code should be consistent with existing code in the codebase. Follow established patterns and conventions. |

## Quick Reference

| Topic | Guidance |
|-------|----------|
| **Formatting** | Always run `gofmt`. Use `goimports` for import management. No rigid line length limit; break lines by semantics, not length. |
| **Naming** | Short names for short scope. Package names should be short and meaningful. Initialisms are consistent case (e.g., `URL`, `ID`, `HTTP`). No underscores. |
| **Comments** | Doc comments are full sentences starting with the thing being described. Package comments appear adjacent to the package clause. |
| **Error Handling** | Never discard errors. Return errors as final values. Error strings are not capitalized. Handle errors first, keep normal path at minimal indentation. Avoid in-band errors. |
| **Interfaces** | Define interfaces on the consumer side. Return concrete types from constructors. Don't define interfaces prematurely. |
| **Context** | Pass `context.Context` as the first parameter. Don't store Context in structs. Use `context.Background()` only when there's a good reason. |
| **Concurrency** | Make goroutine lifetimes clear. Prefer synchronous functions. Document when goroutines exit. |
| **Empty Slices** | Use `var t []string` over `t := []string{}`. |
| **Imports** | Group by type (stdlib, third-party) with blank lines. Avoid renaming, blank imports (except main/test), and dot imports (except in tests with circular deps). |
| **Receivers** | When in doubt, use pointer receivers. Don't mix value and pointer receivers on the same type. Receiver names should be short and consistent. |
| **Variables** | Short names for local scope. Descriptive names for wide scope. Named result parameters only when clarity demands it. |

## Usage

Load this skill when:

- Writing new Go code and you want to ensure it follows idiomatic style
- Reviewing Go code and checking against common style issues
- Refactoring existing Go code to improve readability and maintainability
- Onboarding new team members to a Go codebase
- Establishing or enforcing team Go style conventions

### Triggers

- "go style"
- "golang"
- "go code review"
- "go best practices"
- "write go code"
- "go formatting"
- "gofmt"

## See Also

- **[Effective Go](https://go.dev/doc/effective_go)** — Official Go tips for writing clear, performant, idiomatic code.
- **[Go Language Specification](https://go.dev/ref/spec)** — The definitive reference for the Go language.
- **[Go Test Comments](https://go.dev/wiki/TestComments)** — Common comments related to testing in Go.
- **[Go Proverbs](https://go-proverbs.github.io/)** — The guiding principles of the Go project.
- **[Rob Pike: Go and Dogma](https://research.swtch.com/dogma)** — Essays on Go design philosophy.
- **[Rob Pike: Less is exponentially more](https://commandcenter.blogspot.com/2012/06/less-is-exponentially-more.html)** — On simplicity in software design.
