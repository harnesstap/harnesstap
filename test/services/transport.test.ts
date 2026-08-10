import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  formatPluginExportToml,
  parsePluginExportToml,
} from "../../src/services/transport/plugin.ts";
import {
  makeMultiPluginExport,
  makeSinglePluginExport,
  parseTestPluginToml,
  writePluginExportToml,
} from "../helpers/transport-fixtures.ts";

describe("transport TOML round-trip", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a single-plugin export through TOML", () => {
    const bundle = makeSinglePluginExport({
      name: "pagerduty",
      version: "1.0.0",
      resources: [
        {
          type: "instruction",
          name: "oncall-guide",
          description: "",
          content: "# On-call",
          metadata: {},
          namespace: "",
          origin_kind: "manual",
          origin_ref: "",
          content_hash: "",
          content_blob_ref: "",
        },
      ],
    });

    const parsed = parsePluginExportToml(formatPluginExportToml(bundle));
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0]?.name).toBe("pagerduty");
    expect(parsed.plugins[0]?.resources[0]?.content).toBe("# On-call");
  });

  it("round-trips a multi-plugin export through TOML", () => {
    const bundle = makeMultiPluginExport([
      { name: "alpha", version: "1.0.0" },
      { name: "beta", version: "2.0.0" },
    ]);

    const parsed = parseTestPluginToml(formatPluginExportToml(bundle));
    expect(parsed.plugins.map((plugin) => plugin.name)).toEqual(["alpha", "beta"]);
  });

  it("writes plugin exports to .harnesstap.toml paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-transport-plugin-"));
    tempDirs.push(dir);

    const bundlePath = join(dir, "bundle.harnesstap.toml");
    writePluginExportToml(
      bundlePath,
      makeSinglePluginExport({ name: "exported-plugin" }),
    );

    const parsed = parsePluginExportToml(readFileSync(bundlePath, "utf-8"));
    expect(parsed.plugins[0]?.name).toBe("exported-plugin");
  });
});
