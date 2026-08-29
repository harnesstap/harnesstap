import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectRuntimeApmDependencies,
  isFilesystemApmDependency,
  parseApmDependencyString,
} from "../../src/services/apm-dependencies.ts";
import { apmDependencyIdentity } from "../../src/services/apm-graph.ts";
import { readPackageRuntimeApmDependencies } from "../../src/services/apm-manifest.ts";
import { createTempDir } from "../helpers/fs.ts";

describe("transitive dependencies.apm helpers", () => {
  it("walks only runtime dependencies.apm, not nested devDependencies", () => {
    const runtime = collectRuntimeApmDependencies({
      dependencies: { apm: ["acme/runtime"] },
      devDependencies: { apm: ["acme/dev-only"] },
    });
    expect(runtime.map((entry) => entry.name)).toEqual(["runtime"]);
  });

  it("classifies filesystem path entries", () => {
    expect(isFilesystemApmDependency(parseApmDependencyString("./vendor/kit"))).toBe(true);
    expect(isFilesystemApmDependency(parseApmDependencyString("team-stack"))).toBe(false);
  });

  it("reads nested apm.yml without requiring overlay inspect", () => {
    const dir = createTempDir("apm-nested-manifest-");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "apm.yml"),
      `name: sample
version: "1.0.0"
dependencies:
  apm:
    - ./review-and-refactor
devDependencies:
  apm:
    - ./dev-tool
`,
    );
    const deps = readPackageRuntimeApmDependencies(dir);
    expect(deps).toHaveLength(1);
    expect(deps[0]?.originRef).toBe("./review-and-refactor");
  });

  it("keys git identities by canonical repo and virtual path", () => {
    const dep = parseApmDependencyString("https://github.com/acme/kit.git#main");
    expect(apmDependencyIdentity(dep, "/tmp")).toContain("git:github.com/acme/kit");
  });
});
