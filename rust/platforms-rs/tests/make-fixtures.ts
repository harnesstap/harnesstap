// Records the platform registry from the original for the Rust test and for
// `gen-data.py`, which writes `src/data.rs` from it.
// Run: bun rust/platforms-rs/tests/make-fixtures.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAllPlatforms,
  getPlatform,
  getPlatformIds,
  RESOURCE_CLASSES,
  resourceClass,
} from "../../../src/platforms/registry.ts";

const plain = (p: object) =>
  JSON.parse(JSON.stringify(p, (_k, v) => (v instanceof Set ? [...v] : v)));

const lookups = ["claude-code", "cursor", "droid", "kilo", "nope", "", "constructor", "Claude-Code"];
const fixture = {
  platforms: getAllPlatforms().map(plain),
  ids: getPlatformIds(),
  lookups: lookups.map((id) => ({ id, found: getPlatform(id)?.id ?? null })),
  resourceClasses: RESOURCE_CLASSES,
  resourceClassCalls: Object.keys(RESOURCE_CLASSES).map((t) => [t, resourceClass(t as never)]),
};
writeFileSync(join(import.meta.dir, "fixtures", "registry.json"), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`${fixture.platforms.length} platforms`);
