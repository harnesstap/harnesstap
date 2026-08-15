import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const appSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
  "utf8",
);

describe("desktop header chrome", () => {
  test("does not render a sidecar connected glyph", () => {
    expect(appSource).not.toContain("connection-indicator");
    expect(appSource).not.toMatch(/\bUnplug\b/);
  });

  test("keeps a connected test hook for e2e readiness", () => {
    expect(appSource).toContain('"agent-connected"');
  });
});
