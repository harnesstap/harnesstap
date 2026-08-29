import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempDir } from "../../helpers/fs.ts";
import {
  LICENSE_KIND_EXPRESSION,
  LICENSE_KIND_ID,
  LICENSE_KIND_NAMED,
  classifyDeclaredLicense,
  readDeclaredLicense,
} from "../../../src/services/export/license.ts";

describe("declared license", () => {
  it("classifies SPDX ids, expressions, and named assertions", () => {
    expect(classifyDeclaredLicense("MIT")).toEqual({ kind: LICENSE_KIND_ID, value: "MIT" });
    expect(classifyDeclaredLicense("(MIT OR Apache-2.0)")).toEqual({
      kind: LICENSE_KIND_EXPRESSION,
      value: "(MIT OR Apache-2.0)",
    });
    expect(classifyDeclaredLicense("UNLICENSED")).toEqual({
      kind: LICENSE_KIND_NAMED,
      value: "UNLICENSED",
    });
    expect(classifyDeclaredLicense("mit")).toEqual({ kind: LICENSE_KIND_NAMED, value: "mit" });
  });

  it("reads license from apm.yml and never invents a value", () => {
    const dir = createTempDir("declared-license-");
    writeFileSync(join(dir, "apm.yml"), "name: demo\nversion: \"1.0.0\"\nlicense: Apache-2.0\n");
    writeFileSync(join(dir, "LICENSE"), "this file must be ignored\n");
    expect(readDeclaredLicense(dir)).toBe("Apache-2.0");

    const pluginOnly = createTempDir("declared-license-plugin-");
    writeFileSync(
      join(pluginOnly, "plugin.json"),
      JSON.stringify({ name: "demo", version: "1.0.0", license: "MIT" }),
    );
    expect(readDeclaredLicense(pluginOnly)).toBe("MIT");

    const empty = createTempDir("declared-license-empty-");
    mkdirSync(empty, { recursive: true });
    expect(readDeclaredLicense(empty)).toBeUndefined();
  });
});
