import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  formatLayerExportToml,
  parseLayerExportToml,
} from "../../src/services/transport/layer.ts";
import {
  makeMultiLayerExport,
  makeSingleLayerExport,
  parseTestLayerToml,
  writeLayerExportToml,
} from "../helpers/transport-fixtures.ts";

describe("transport TOML round-trip", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a single-layer export through TOML", () => {
    const bundle = makeSingleLayerExport({
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

    const parsed = parseLayerExportToml(formatLayerExportToml(bundle));
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0]?.name).toBe("pagerduty");
    expect(parsed.layers[0]?.resources[0]?.content).toBe("# On-call");
  });

  it("round-trips a multi-layer export through TOML", () => {
    const bundle = makeMultiLayerExport([
      { name: "alpha", version: "1.0.0" },
      { name: "beta", version: "2.0.0" },
    ]);

    const parsed = parseTestLayerToml(formatLayerExportToml(bundle));
    expect(parsed.layers.map((layer) => layer.name)).toEqual(["alpha", "beta"]);
  });

  it("writes layer exports to .harnesstap.toml paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-transport-layer-"));
    tempDirs.push(dir);

    const bundlePath = join(dir, "bundle.harnesstap.toml");
    writeLayerExportToml(
      bundlePath,
      makeSingleLayerExport({ name: "exported-layer" }),
    );

    const parsed = parseLayerExportToml(readFileSync(bundlePath, "utf-8"));
    expect(parsed.layers[0]?.name).toBe("exported-layer");
  });
});
