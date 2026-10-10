import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  MarketplaceSourceError,
  assertMarketplaceSourceReachable,
} from "../../src/services/marketplace-validate.ts";

describe("assertMarketplaceSourceReachable", () => {
  it("accepts a local git folder with a marketplace manifest", async () => {
    const repo = mkdtempSync(join(tmpdir(), "ht-mkt-valid-"));
    mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(repo, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ name: "ok", plugins: [] }),
    );
    await expect(assertMarketplaceSourceReachable(repo)).resolves.toBeUndefined();
  });

  it("rejects a missing local path without saving wording", async () => {
    const missing = join(tmpdir(), `ht-mkt-missing-${Date.now()}`);
    try {
      await assertMarketplaceSourceReachable(missing);
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MarketplaceSourceError);
      expect((error as MarketplaceSourceError).message).toContain("Couldn't find a marketplace");
    }
  });

  it("rejects a local folder that is not a marketplace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-mkt-empty-"));
    try {
      await assertMarketplaceSourceReachable(dir);
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MarketplaceSourceError);
      expect((error as MarketplaceSourceError).message).toContain("is not a marketplace");
    }
  });

  it("rejects an unreachable remote without prompting", async () => {
    try {
      await assertMarketplaceSourceReachable("https://github.com/example/does-not-exist-ht.git", {
        runCommand: () => ({
          stdout: "",
          stderr: "fatal: repository not found",
          exitCode: 128,
        }),
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MarketplaceSourceError);
      expect((error as MarketplaceSourceError).message).toContain("Couldn't reach");
      expect((error as MarketplaceSourceError).hint).toContain("ht github login");
      expect((error as MarketplaceSourceError).hint).toContain("Nothing was saved.");
    }
  });
});
