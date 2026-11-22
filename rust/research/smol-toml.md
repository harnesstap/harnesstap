# A smol-toml 1.6.1 compatible parser

## How the original uses it

`parse` from `smol-toml` in 12 files: `src/services/toml/read.ts` (`parseTransportToml`,
which `toml-rs` left in TS for this reason), the Codex, Grok Build and Gemini CLI
platforms, `agent-bridge.ts`, `host-config-strip.ts`, `plugin-source-import.ts`,
`native-agent-plugins.ts`, `file-contents-drift.ts`, `format-preserving-config.ts` and
`environment-import-export.ts`. `stringify` is already reproduced in `toml-rs`.

## What a port has to reproduce

Checked against smol-toml 1.6.1:

| TOML | smol-toml gives |
| --- | --- |
| `b=1` `2=2` `a=3` | `{"2":2,"b":1,"a":3}`: JavaScript object key order, array-index keys first |
| `x=9007199254740993` | error `integer value cannot be represented losslessly` |
| `x=1979-05-27T07:32:00Z`, `x=07:32:00` | a `TomlDate` (a `Date`), printed by `JSON.stringify` as `1979-05-27T07:32:00.000Z` or `07:32:00.000` |
| `x=inf`, `x=1e400` | `Infinity`, which `JSON.stringify` prints as `null` |
| `a=1` `a=2` | error `trying to redefine an already defined table or value` |

Errors are `TomlError` with the message
`Invalid TOML document: <reason>\n\n<line>:  <source line>\n<caret>\n`, plus `line` and
`column`. `read.ts` wraps it as `Invalid <label> TOML: <message>`, which reaches the user, so
the reason text and the code block must match.

## Crate options

- `toml` 0.9 / `toml_parser`: a TOML 1.0 parser with spans. It is strict where smol-toml is
  strict, and its values convert cleanly. Its error messages are different.
- `toml_edit`: keeps layout, which `format-preserving-config.ts` would like, but has the
  same error text gap.

## Recommendation

Parse with `toml_parser` (or `toml`), convert to a `serde_json::Value`-like tree with:
JavaScript key order, the lossless integer check (|n| > 2^53 - 1 is an error), dates as
a `TomlDate` variant that prints like `Date.toISOString` and smol-toml's local forms,
and infinities kept as floats. Map each `toml` error to smol-toml's reason string. Build
the table from smol-toml's `error.ts` call sites (33 messages in 1.6.1). Rebuild the code block
from the span. Pin it with a fixture corpus: the toml-test suite (valid and invalid) run
through smol-toml, plus every `.toml` file in `rust/app-cases`. Port `parseTransportToml`
into `toml-rs` once that passes.
