# `hd` Alias Design

## Context

HarnessDeck is currently published with a single executable, `harnessdeck`, via
`package.json#bin`. The CLI entrypoint in `src/index.ts` hardcodes
`harnessdeck` into the top-level Commander program name, custom help output,
deprecation warnings, and user-facing follow-up suggestions. The CLI test
harness in `test/helpers/cli.ts` also always simulates invocation as
`harnessdeck`.

The user asked for support for `hd` as an alias to the `harnessdeck` command.
The user was unavailable for scope confirmation, so this design proceeds with
the explicit assumption that `hd` should be a **first-class alias**: users
should be able to install and invoke `hd`, and help/suggestion output should
reflect whichever binary name launched the process.

## Approaches

### 1. Packaging-only alias

Add `"hd": "./dist/index.js"` to `package.json#bin` and leave runtime/help text
unchanged.

- **Pros:** smallest change
- **Cons:** `hd --help` would still print `harnessdeck`, and warning text would
  still point users at `harnessdeck ...`, which feels unfinished

### 2. Packaging alias plus docs

Add the second bin entry and mention `hd` in installation/usage docs, but keep
runtime output fixed to `harnessdeck`.

- **Pros:** better discoverability than packaging-only
- **Cons:** runtime polish problem remains; CLI suggestions do not mirror the
  command the user actually typed

### 3. First-class runtime alias **(recommended)**

Add the second bin entry and make the CLI derive its display/invocation name
from the executed binary (`process.argv[1]`), normalizing supported aliases to
either `harnessdeck` or `hd`. Reuse that derived name in help output,
deprecation warnings, and user guidance strings. Update tests and docs
accordingly.

- **Pros:** `hd` feels native, docs can teach both forms, and existing
  `harnessdeck` behavior remains intact
- **Cons:** touches a few more runtime strings and tests

## Recommended Design

### Packaging

Update `package.json#bin` to publish both:

- `harnessdeck -> ./dist/index.js`
- `hd -> ./dist/index.js`

This keeps the published artifact model simple: one built entrypoint, two
binary names.

### Runtime command-name resolution

Add a small helper near the top of `src/index.ts` that:

1. Reads `process.argv[1]`
2. Extracts the basename
3. Normalizes known launch names:
   - `hd` -> `hd`
   - `harnessdeck` -> `harnessdeck`
   - anything else -> `harnessdeck` (safe fallback for tests and direct Node
     execution)

That helper becomes the single source of truth for user-visible command
references. The Commander program name should be set from it, and a tiny helper
such as `formatCommand(path: string)` should build strings like
`hd project scan` or `harnessdeck project scan`.

### User-visible surfaces to update

Use the resolved invocation name in:

- top-level help banner and `USAGE` line
- top-level `isTopLevel` detection inside `configureHelp`
- follow-up guidance strings such as:
  - `Run \`… project scan\` first.`
  - `Use \`… project history\` to list them.`
  - preset/resource summary footers
- deprecated command warnings so `hd scan` recommends `hd project scan`

Do **not** rename the product itself. Strings such as the package name,
database filenames, bundle schemas, or product descriptions remain
`harnessdeck`.

### Testing

Cover three behaviors:

1. `package.json` publishes both executable names
2. invoking the CLI as `hd` renders top-level help with `hd` in the title/usage
3. user guidance and deprecated-command warnings follow the invoked binary name

To support those tests, extend the CLI test helper so tests can simulate the
binary name instead of always hardcoding `process.argv = ["node", "harnessdeck",
...]`.

### Error handling and compatibility

- Unknown invocation names fall back to `harnessdeck`
- Existing `harnessdeck` invocation behavior remains unchanged
- No database, schema, or preset format changes are required

## File impact

- **Modify:** `package.json` — add the `hd` bin entry
- **Modify:** `src/index.ts` — resolve invocation name once and reuse it in
  help/warnings/suggestions
- **Modify:** `test/helpers/cli.ts` — allow tests to simulate `hd`
- **Modify:** `test/cli/help-organization.test.ts` — assert `hd --help`
- **Modify:** one or more existing CLI tests that assert follow-up text using
  `harnessdeck`
- **Add or modify:** one test that asserts `package.json#bin.hd`

## Success criteria

- Global/local installs expose both `harnessdeck` and `hd`
- `hd --help` prints `hd [options] [command]`
- `hd scan` warns users to run `hd project scan`
- Existing `harnessdeck` invocations still behave exactly as before
