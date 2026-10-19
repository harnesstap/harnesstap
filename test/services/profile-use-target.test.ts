import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ApPackageFiles } from "../../src/services/agent-plugins/files.ts";
import * as catalogClient from "../../src/services/catalog-client.ts";
import { resolveDownloadedVersion } from "../../src/services/catalog-client.ts";
import type { CatalogPlugin } from "../../src/services/catalog-types.ts";
import { installPluginFromCatalog } from "../../src/services/plugin-catalog-install.ts";
import { handlePluginShowCommand } from "../../src/cli/handlers/plugin-show-command.ts";
import { showProfileCommand } from "../../src/services/profile-commands.ts";
import {
  findLocalPluginBySelector,
  findLocalProfileForUse,
  LocalPluginSelectorError,
  ProfileUseTargetError,
  resolveProfileUseTarget,
} from "../../src/services/profile-use-target.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("profile-use-target-");
});

afterEach(async () => {
  await ctx.cleanup();
});

const REF = "harnesstap-cloud/default/engineering-foundation";

/** The shape harnesstap-cloud/default/engineering-foundation@1.0.1 serves. */
function foundationPackage(): ApPackageFiles {
  return {
    "plugin.json": {
      encoding: "utf8",
      content: JSON.stringify({
        name: "engineering-foundation",
        version: "1.0.1",
        description: "Shared baseline for every persona",
        extensions: {
          "com.harnesstap": {
            schema: "urn:harnesstap:ap-extension:v1",
            sourceName: "Engineering foundation",
            profile: true,
            dependencies: [],
            overrides: { versions: {}, resources: {} },
            needs: [],
            components: {},
          },
        },
      }),
    },
  } as ApPackageFiles;
}

function mockCatalog(options: { downloadFails?: boolean } = {}) {
  const files = foundationPackage();
  const download = spyOn(catalogClient, "downloadCatalogPackage").mockImplementation(
    async (input) => {
      if (options.downloadFails) throw new Error("fetch failed");
      return { version: resolveDownloadedVersion(input.version ?? "latest", files), files };
    },
  );
  const listing = spyOn(catalogClient, "fetchCatalogPlugin").mockRejectedValue(
    new Error("offline"),
  );
  const search = spyOn(catalogClient, "listPluginsInScope").mockResolvedValue([
    {
      orgSlug: "harnesstap-cloud",
      catalogSlug: "default",
      slug: "engineering-foundation",
      name: "Engineering foundation",
      summary: "Shared baseline for every persona",
      latestVersion: "1.0.1",
    } as CatalogPlugin,
  ]);
  return {
    download,
    restore: () => {
      download.mockRestore();
      listing.mockRestore();
      search.mockRestore();
    },
  };
}

async function pullFoundation(as?: string): Promise<string> {
  const catalog = mockCatalog();
  try {
    const pulled = await installPluginFromCatalog(
      { org_slug: "harnesstap-cloud", catalog_slug: "default", plugin_slug: "engineering-foundation" },
      { profile: true, ...(as ? { as } : {}) },
    );
    return pulled.pluginId;
  } finally {
    catalog.restore();
  }
}

describe("findLocalProfileForUse", () => {
  it("finds a pulled profile by slug, full ref, ref@version, and display name", async () => {
    const id = await pullFoundation();
    for (const selector of [
      "engineering-foundation",
      REF,
      `${REF}@1.0.1`,
      "Engineering foundation",
      "engineering foundation",
    ]) {
      expect(findLocalProfileForUse(selector)?.id).toBe(id);
    }
    expect(findLocalProfileForUse(`${REF}@9.9.9`)).toBeUndefined();
  });

  it("finds a profile pulled under its display name by slug and full ref", async () => {
    // Releases before the slug fix stored the package display name.
    const id = await pullFoundation("Engineering foundation");
    expect(findLocalProfileForUse("engineering-foundation")?.id).toBe(id);
    expect(findLocalProfileForUse(REF)?.id).toBe(id);
  });
});

describe("findLocalPluginBySelector", () => {
  it("resolves plugin show and doctor selectors like profile use", async () => {
    const id = await pullFoundation("Engineering foundation");
    for (const selector of ["engineering-foundation", REF, `${REF}@1.0.1`, "Engineering foundation"]) {
      expect(findLocalPluginBySelector(selector, { command: "ht plugin show" })?.id).toBe(id);
    }
    expect(findLocalPluginBySelector("unknown-plugin")).toBeUndefined();
  });

  it("names the full ref when a bare name matches two local plugins", async () => {
    await pullFoundation();
    await pullFoundation("Engineering foundation");
    const error = (() => {
      try {
        return findLocalPluginBySelector(REF, { command: "ht plugin doctor" });
      } catch (err) {
        return err;
      }
    })();
    expect(error).toBeInstanceOf(LocalPluginSelectorError);
    expect(error).not.toBeInstanceOf(ProfileUseTargetError);
    expect((error as LocalPluginSelectorError).hints).toEqual([
      "Use the full catalog ref: ht plugin doctor org/catalog/slug@version",
    ]);
  });

  it("lets profile show open a profile by slug, catalog ref, and display name", async () => {
    const id = await pullFoundation();
    for (const selector of ["engineering-foundation", `${REF}@1.0.1`, "Engineering foundation"]) {
      expect(showProfileCommand(selector).profile.id).toBe(id);
    }
  });

  it("lets plugin show open a profile by slug and catalog ref", async () => {
    const id = await pullFoundation("Engineering foundation");
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const selector of ["engineering-foundation", `${REF}@1.0.1`]) {
        log.mockClear();
        process.exitCode = 0;
        handlePluginShowCommand(selector, { format: "json" });
        expect(process.exitCode).toBe(0);
        const shown = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { id?: string; plugin?: { id?: string } };
        expect(shown.plugin?.id ?? shown.id).toBe(id);
      }
    } finally {
      log.mockRestore();
      process.exitCode = 0;
    }
  });
});

describe("resolveProfileUseTarget", () => {
  it("pulls a profile that is not installed, then reuses the local copy", async () => {
    const catalog = mockCatalog();
    try {
      const first = await resolveProfileUseTarget(REF);
      expect(first.name).toBe("engineering-foundation");
      expect(first.pulled?.source).toContain("engineering-foundation");

      const byDisplayName = await resolveProfileUseTarget("Engineering foundation");
      expect(byDisplayName.selector).toBe(first.selector);
      expect(byDisplayName.pulled).toBeUndefined();
      expect(catalog.download).toHaveBeenCalledTimes(1);
    } finally {
      catalog.restore();
    }
  });

  it("pulls by display name through the catalog search", async () => {
    const catalog = mockCatalog();
    try {
      const target = await resolveProfileUseTarget("Engineering foundation");
      expect(target.name).toBe("engineering-foundation");
      expect(target.pulled).toBeDefined();
    } finally {
      catalog.restore();
    }
  });

  it("names the exact pull command when the download fails", async () => {
    const catalog = mockCatalog({ downloadFails: true });
    try {
      const error = await resolveProfileUseTarget("engineering-foundation").catch((err) => err);
      expect(error).toBeInstanceOf(ProfileUseTargetError);
      expect((error as ProfileUseTargetError).message).toContain("fetch failed");
      expect((error as ProfileUseTargetError).hints).toEqual([
        `Pull it first: ht profile pull ${REF}@1.0.1`,
      ]);
    } finally {
      catalog.restore();
    }
  });

  it("does not contact the catalog with --no-pull", async () => {
    const catalog = mockCatalog();
    try {
      const error = await resolveProfileUseTarget("Engineering foundation", { pull: false })
        .catch((err) => err);
      expect(error).toBeInstanceOf(ProfileUseTargetError);
      expect((error as ProfileUseTargetError).hints).toEqual([
        'Pull it first: ht profile pull "Engineering foundation"',
      ]);
      expect(catalog.download).not.toHaveBeenCalled();
    } finally {
      catalog.restore();
    }
  });
});
