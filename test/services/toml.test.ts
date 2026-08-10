import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertTomlExtension,
  environmentToTomlDocument,
  environmentsFromTomlRecord,
  environmentsToTomlRecord,
  formatTransportToml,
  parseTransportToml,
  readSchemaHeader,
  sortKeysDeep,
  sortStringRecord,
} from "../../src/services/toml/index.ts";

describe("toml primitives", () => {
  it("sorts object keys deeply", () => {
    expect(sortKeysDeep({ b: 1, a: { d: 2, c: 3 } })).toEqual({
      a: { c: 3, d: 2 },
      b: 1,
    });
  });

  it("sorts string records", () => {
    expect(sortStringRecord({ z: "1", a: "2" })).toEqual({ a: "2", z: "1" });
  });

  it("round-trips TOML documents", () => {
    const raw = formatTransportToml({ schema: "urn:harnesstap:project:v1", version: 1 });
    const parsed = parseTransportToml(raw, "project");
    expect(readSchemaHeader(parsed)).toEqual({
      schema: "urn:harnesstap:project:v1",
      version: 1,
    });
  });

  it("assertTomlExtension accepts .toml and rejects other extensions", () => {
    expect(() => assertTomlExtension("/tmp/config.toml")).not.toThrow();
    expect(() => assertTomlExtension("/tmp/config.json")).toThrow(/JSON transport was removed/);
    expect(() => assertTomlExtension("/tmp/config.yaml")).toThrow(/Expected a \.toml file/);
  });
});

describe("environment-document", () => {
  it("round-trips environment tables", () => {
    const environments = [
      {
        name: "work",
        values: { MODEL: "opus" },
        secret_refs: { TOKEN: { provider: "env" as const, ref: "TOKEN" } },
      },
    ];
    const record = environmentsToTomlRecord(environments);
    expect(environmentsFromTomlRecord(record)).toEqual(environments);
    expect(environmentToTomlDocument(environments[0]!)).toEqual({
      name: "work",
      values: { MODEL: "opus" },
      secret_refs: { TOKEN: { provider: "env", ref: "TOKEN" } },
    });
  });

  it("writes environment documents as TOML files", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-toml-env-"));
    try {
      const path = join(dir, "work.toml");
      writeFileSync(
        path,
        formatTransportToml(
          environmentToTomlDocument({ name: "work", values: { A: "1" } }),
        ),
        "utf-8",
      );
      assertTomlExtension(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
