# Contributing

Every package in `@ingestron/pack-databricks` must be understandable by someone who has never seen it:
simple code, and documentation with enough examples to use it without reading
the source. The rules below make that checkable.

## Code

- **One direction of flow.** A package is a short pipeline of steps, one
  module per step. Each step takes plain data and returns plain data plus
  diagnostics. No step reaches back into an earlier one. Recursion inside one
  step is fine, for example resolving a file that includes another.
- **Small units.** At most 200 lines per file, 40 lines per function, nesting
  at most 3 deep, complexity at most 10. ESLint enforces these; an exception
  needs a comment explaining why.
- **I/O at the edges.** Core logic does not import `node:fs`; it reads through
  a small interface, so it runs in Node, browsers and tests alike.
- **Functions and plain objects first.** A class only for real state with a
  lifetime. No inheritance.
- **Few dependencies.** Each runtime dependency needs a reason in the
  package README.

Writing style:

| Do                                                     | Avoid                                    |
| ------------------------------------------------------ | ---------------------------------------- |
| One check per rule, each with its own message and code | `check(a && b && c, "X", "Invalid")`     |
| Descriptive names                                      | `v`, `k`, `out`, `tmp`                   |
| One declaration per statement                          | `const a = 1, b = 2;`                    |
| Visible rules, documented once                         | Behaviour that depends on a field's name |
| Limits in one documented options object with defaults  | Magic numbers at call sites              |
| Shared guards written once (`isSafeKey`)               | The same check copied into several files |
| Comments that explain why                              | Comments that repeat what the code says  |

Every public export has a doc comment with an example. ESLint fails on a
missing one. Packages meet only at their entry points: ESLint refuses an
import of another package's files or a relative path out of the package.

## Documentation

User documentation lives in the documentation site,
[ingestron/docs](https://github.com/ingestron/docs); change it there in the same
release as the code. Package READMEs say what the package is, how to install
it and how to develop it. Every `ts` code block in a README must be a complete
file; `pnpm validate` type-checks them all.

## Tests

- Write the test first and watch it fail.
- Test names read as sentences describing behaviour.

## Done means

1. `pnpm validate` passes: format, lint, type-check, tests, examples, docs.
2. A public API change updates the API report (`pnpm api` writes `api/`), so
   reviewers see the interface change, and the documentation site.
3. **Fresh-reader check:** someone without prior context reads the changed
   module and its docs and correctly explains what it does and how to use it.
   What they misread is fixed in the code or docs.
4. Report line counts and the number of public exports, so growth is visible.

## Licence

Ingestron is licensed under the [Apache License 2.0](LICENSE). By contributing,
you agree that your contribution is licensed under the same terms.

Every commit is signed off under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): add
`-s` to `git commit`, which appends `Signed-off-by: Your Name <you@example.com>`
matching the commit author. `pnpm dco:check` checks the commits since
`origin/main`; pull requests run it too.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
