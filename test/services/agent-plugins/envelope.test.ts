import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../../helpers/db.ts";
import type { TestContext } from "../../helpers/db.ts";
import { addResourceToPlugin, createPlugin } from "../../../src/models/plugin-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import {
  AP_PACKAGE_SCHEMA,
  buildApPackageFiles,
} from "../../../src/services/agent-plugins/files.ts";
import {
  AP_ENVELOPE_EXTENSION,
  isApEnvelopePath,
  readApEnvelope,
  writeApEnvelope,
} from "../../../src/services/agent-plugins/envelope.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("ap-envelope-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function seed(): string {
  const plugin = createPlugin({ name: "my-plugin", version: "1.2.0" });
  addResourceToPlugin(
    plugin.id,
    createResource({
      type: "skill",
      name: "deploy",
      description: "Deployment workflow",
      content: "# Deploy",
      metadata: {},
      source: "test",
    }).id,
  );
  return plugin.id;
}

describe("writeApEnvelope", () => {
  it("writes a schema-tagged envelope with sorted file keys", () => {
    const out = join(ctx.projectDir, `my-plugin${AP_ENVELOPE_EXTENSION}`);
    writeApEnvelope(buildApPackageFiles(seed()), out);
    const document = JSON.parse(readFileSync(out, "utf8")) as {
      schema: string;
      files: Record<string, unknown>;
    };
    expect(document.schema).toBe(AP_PACKAGE_SCHEMA);
    expect(Object.keys(document.files)).toEqual(["plugin.json", "skills/deploy/SKILL.md"]);
  });

  it("is byte-identical for the same plugin", () => {
    const id = seed();
    const a = join(ctx.projectDir, `a${AP_ENVELOPE_EXTENSION}`);
    const b = join(ctx.projectDir, `b${AP_ENVELOPE_EXTENSION}`);
    writeApEnvelope(buildApPackageFiles(id), a);
    writeApEnvelope(buildApPackageFiles(id), b);
    expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
  });
});

describe("readApEnvelope", () => {
  it("round-trips to the same file map", () => {
    const files = buildApPackageFiles(seed());
    const out = join(ctx.projectDir, `p${AP_ENVELOPE_EXTENSION}`);
    writeApEnvelope(files, out);
    expect(readApEnvelope(out)).toEqual(files);
  });

  it("rejects an envelope with an unknown schema", () => {
    const out = join(ctx.projectDir, `bad${AP_ENVELOPE_EXTENSION}`);
    writeFileSync(out, JSON.stringify({ schema: "urn:harnesstap:ap-package:v99", files: {} }));
    expect(() => readApEnvelope(out)).toThrow(/schema/);
  });

  it("rejects an envelope whose files escape the root", () => {
    const out = join(ctx.projectDir, `evil${AP_ENVELOPE_EXTENSION}`);
    writeFileSync(
      out,
      JSON.stringify({
        schema: AP_PACKAGE_SCHEMA,
        files: { "../escape.md": { encoding: "utf8", content: "x" } },
      }),
    );
    expect(() => readApEnvelope(out)).toThrow(/escapes the package root/);
  });

  it("rejects a file entry with an unknown encoding", () => {
    const out = join(ctx.projectDir, `enc${AP_ENVELOPE_EXTENSION}`);
    writeFileSync(
      out,
      JSON.stringify({
        schema: AP_PACKAGE_SCHEMA,
        files: { "plugin.json": { encoding: "rot13", content: "{}" } },
      }),
    );
    expect(() => readApEnvelope(out)).toThrow(/encoding/);
  });
});

describe("isApEnvelopePath", () => {
  it("recognizes the envelope extension", () => {
    expect(isApEnvelopePath("/tmp/x.ap.json")).toBe(true);
    expect(isApEnvelopePath("/tmp/x.json")).toBe(false);
    expect(isApEnvelopePath("/tmp/x.harnesstap.toml")).toBe(false);
  });
});
