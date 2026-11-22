# ulid 2.4.0

## How the original uses it

`ulid()` from `ulid` mints row ids in 22 files, mostly `src/models/*` and the
snapshot, apply and import services. No file uses `monotonicFactory`, `decodeTime` or
`detectPrng`, and nothing sorts by id inside one millisecond.

## What a port has to reproduce

- 26 characters of Crockford base32, uppercase: 10 for the time in milliseconds,
  16 random (`01M82TKKWP0VC8WTXGMX6Q0DMZ`).
- Plain `ulid()` is not monotonic. Two ids from the same millisecond are in random order.
- The recorded cases normalize ULIDs (ADR-010), so the exact values never need to match.

## Crate options

- `ulid` (crates.io): `Ulid::new().to_string()` gives the same format. Its `Generator`
  is monotonic, which is stricter than the original but harmless.

## Recommendation

Use `ulid` with `Ulid::new()`. To pin ids in db fixture tests (see `db-rs`), the models
should take the id source and the clock as parameters, the way the tests of the
original stub them with `spyOn`.
