# Research: dependencies with no drop-in crate

ADR-009 lists the npm dependencies whose fit was `unknown` in the plan. Each file
here says how the original uses the package, what a port has to reproduce, the
crate options, and a recommendation. Versions are the ones in `node_modules` on
2026-11-22.

| Package | Version | Files using it | Recommendation |
| --- | --- | --- | --- |
| [`gray-matter`](gray-matter.md) | 4.0.3 (js-yaml 3.14.2) | 9 | hand port of the split, saphyr for reading, a js-yaml 3 `safeDump` emitter for writing |
| [`ulid`](ulid.md) | 2.4.0 | 22 | `ulid` crate, `Ulid::new()` |
| [`@inquirer/core`, `@inquirer/search`](inquirer.md) | 10.3.2, 3.2.2 | 9 | port the prompts on `crossterm`, keep the text in recorded cases |
| [`cli-table3`](cli-table3.md) | 0.6.5 | 1 (13 callers) | hand port of the subset `src/ui/table.ts` uses |
| [smol-toml parser](smol-toml.md) | 1.6.1 | 12 | `toml` (`toml_parser`) plus a conversion layer, with smol-toml's error text |
