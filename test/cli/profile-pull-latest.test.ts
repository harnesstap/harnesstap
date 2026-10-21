import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { makeApEnvelope } from "../helpers/ap-package-fixtures.ts";
import { getDb } from "../../src/db/connection.ts";
import { getPlugin } from "../../src/models/plugin-model.ts";

async function connectMockAccount(): Promise<void> {
  const cloudAccounts = await import("../../src/config/cloud-accounts.ts");
  await cloudAccounts.saveCloudAccount("test", {
    cloudBaseUrl: "https://mock",
    accessToken: "tok",
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    refreshToken: "r",
    scopes: [],
  });
  await cloudAccounts.setDefaultCloudAccount("test");
}

const CLOUD = ["--account", "test", "--base-url", "https://mock"];

describe("profile pull without --version", () => {
  it("records the package version and profile show works", async () => {
    const context = await createTestContext("cli-profile-pull-latest");
    try {
      await runCli(["init"]);
      await connectMockAccount();
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        plugins: [{
          orgSlug: "acme",
          slug: "cloud-engineer",
          name: "Cloud engineer",
          summary: "Cloud persona",
          latestVersion: "1.0.2",
          updatedAt: new Date().toISOString(),
          tags: ["profile"],
          visibility: "public",
        }],
        bundle: makeApEnvelope({ name: "cloud-engineer", version: "1.0.2" }),
      });
      try {
        const pulled = await runCli(["profile", "pull", "acme/default/cloud-engineer", "--as", "cloud", ...CLOUD]);
        expect(pulled.exitCode ?? 0).toBe(0);
        // The package version, not the requested word "latest".
        expect(getPlugin("cloud")?.version).toBe("1.0.2");

        const shown = await runCli(["profile", "show", "cloud"]);
        expect(shown.stderr).not.toContain("Invalid version constraint");
        expect(shown.stdout).toContain("cloud");
      } finally {
        restoreFetch();
      }
    } finally {
      await context.cleanup();
    }
  });

  it("still shows a profile that an older CLI recorded as version latest", async () => {
    const context = await createTestContext("cli-profile-pull-latest-compat");
    try {
      await runCli(["init"]);
      await connectMockAccount();
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        bundle: makeApEnvelope({ name: "cloud-engineer", version: "1.0.2" }),
      });
      try {
        await runCli(["profile", "pull", "acme/default/cloud-engineer", "--as", "cloud", ...CLOUD]);
      } finally {
        restoreFetch();
      }
      // harnesstap 1.4.0 stored the requested word, not the package version.
      getDb().prepare("UPDATE plugins SET version = 'latest' WHERE name = 'cloud'").run();

      const shown = await runCli(["profile", "show", "cloud"]);
      expect(shown.stderr).not.toContain("Invalid version constraint");
      expect(shown.stdout).toContain("cloud");
      const json = await runCli(["profile", "show", "cloud", "--format", "json"]);
      expect(JSON.parse(json.stdout).name).toBe("cloud");
    } finally {
      await context.cleanup();
    }
  });
});
