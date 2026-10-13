import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DESKTOP_CATALOG_TIMEOUT,
  desktopDiscoverError,
} from "../../apps/desktop/src/lib/discover-error.ts";

describe("desktopDiscoverError", () => {
  it("replaces the CLI catalog timeout with Desktop copy", () => {
    const cli =
      "Catalog request timed out (30s). Try again, or list local plugins without --remote.";
    expect(desktopDiscoverError(cli)).toBe(DESKTOP_CATALOG_TIMEOUT);
    expect(desktopDiscoverError(cli)).not.toContain("--remote");
    expect(desktopDiscoverError("Cloud sign-in required")).toBe("Cloud sign-in required");
  });

  it("is applied to Discover group errors", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../apps/desktop/src/components/SourcesWorkspace.tsx"),
      "utf8",
    );
    expect(source).toContain("desktopDiscoverError(marketplaceError)");
    expect(source).toContain("desktopDiscoverError(cloudError.message)");
  });
});
