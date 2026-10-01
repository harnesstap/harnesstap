import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  githubCloneUrl,
  isRelativePluginSourcePath,
  parseMarketplacePluginSource,
  resolveMarketplaceCloneUrl,
} from "../../src/services/host-plugin-source.ts";

function writeKnownMarketplaces(
  homeRoot: string,
  entries: Record<string, unknown>,
): void {
  const dir = join(homeRoot, ".claude", "plugins");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "known_marketplaces.json"),
    `${JSON.stringify(entries, null, 2)}\n`,
  );
}

describe("githubCloneUrl", () => {
  it("keeps owner/repo shorthand and https urls cloneable", () => {
    expect(githubCloneUrl("outbrain/claude-plugins")).toBe(
      "https://github.com/outbrain/claude-plugins.git",
    );
    expect(githubCloneUrl("https://github.com/outbrain/claude-plugins")).toBe(
      "https://github.com/outbrain/claude-plugins.git",
    );
    expect(githubCloneUrl("https://github.com/outbrain/claude-plugins.git")).toBe(
      "https://github.com/outbrain/claude-plugins.git",
    );
    expect(githubCloneUrl("file:///tmp/marketplace")).toBe("file:///tmp/marketplace");
    expect(githubCloneUrl("/tmp/marketplace")).toBe("/tmp/marketplace");
    expect(githubCloneUrl("ssh://git@github.com/outbrain/claude-plugins.git")).toBe(
      "ssh://git@github.com/outbrain/claude-plugins.git",
    );
  });

  it("unwraps SCP remotes and org-id users instead of prefixing https://github.com/", () => {
    expect(githubCloneUrl("git@github.com:outbrain/claude-plugins.git")).toBe(
      "https://github.com/outbrain/claude-plugins.git",
    );
    expect(
      githubCloneUrl("org-1535932@github.com:outbrain/claude-plugins.git"),
    ).toBe("https://github.com/outbrain/claude-plugins.git");
    expect(
      githubCloneUrl("org-1535932@github.com:outbrain/claude-plugins.git/"),
    ).toBe("https://github.com/outbrain/claude-plugins.git");
    expect(githubCloneUrl("github.com:outbrain/claude-plugins.git")).toBe(
      "https://github.com/outbrain/claude-plugins.git",
    );
    expect(
      githubCloneUrl(
        "https://github.com/org-1535932@github.com:outbrain/claude-plugins.git/",
      ),
    ).toBe("https://github.com/outbrain/claude-plugins.git");
    expect(
      githubCloneUrl("https://github.com/git@github.com:outbrain/claude-plugins.git"),
    ).toBe("https://github.com/outbrain/claude-plugins.git");
  });
});

describe("parseMarketplacePluginSource git urls", () => {
  it("normalizes github and url sources that use SCP remotes", () => {
    expect(
      parseMarketplacePluginSource({
        name: "argus",
        source: {
          source: "url",
          url: "org-1535932@github.com:outbrain/claude-plugins.git",
        },
      }),
    ).toMatchObject({
      url: "https://github.com/outbrain/claude-plugins.git",
      path: null,
    });
    expect(
      parseMarketplacePluginSource({
        name: "argus",
        source: {
          source: "github",
          repo: "git@github.com:outbrain/claude-plugins.git",
        },
      }),
    ).toMatchObject({
      url: "https://github.com/outbrain/claude-plugins.git",
    });
    expect(
      parseMarketplacePluginSource({
        name: "argus",
        source: "org-1535932@github.com:outbrain/claude-plugins.git",
      }),
    ).toMatchObject({
      url: "https://github.com/outbrain/claude-plugins.git",
      path: null,
    });
    expect(isRelativePluginSourcePath("org-1535932@github.com:outbrain/claude-plugins.git")).toBe(
      false,
    );
    expect(isRelativePluginSourcePath("./plugins/argus")).toBe(true);
  });
});

describe("resolveMarketplaceCloneUrl", () => {
  it("reads known_marketplaces SCP urls without mixing them into github.com paths", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-clone-url-"));
    writeKnownMarketplaces(home, {
      "teads-plugins": {
        source: {
          source: "url",
          url: "org-1535932@github.com:outbrain/claude-plugins.git",
        },
        installLocation: join(home, "missing-checkout"),
      },
    });
    expect(resolveMarketplaceCloneUrl(home, "teads-plugins")).toBe(
      "https://github.com/outbrain/claude-plugins.git",
    );
  });

  it("unwraps already-mangled https://github.com/<scp> known marketplace urls", () => {
    const home = mkdtempSync(join(tmpdir(), "ht-mkt-clone-mangled-"));
    writeKnownMarketplaces(home, {
      "teads-plugins": {
        source: {
          source: "url",
          url: "https://github.com/org-1535932@github.com:outbrain/claude-plugins.git/",
        },
      },
    });
    expect(resolveMarketplaceCloneUrl(home, "teads-plugins")).toBe(
      "https://github.com/outbrain/claude-plugins.git",
    );
  });
});
