import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir } from "../helpers/fs.ts";
import {
  CURSOR_PUBLIC_GIT_URL,
  CURSOR_PUBLIC_MARKETPLACE,
  builtinMarketplaceGitUrl,
} from "../../src/services/builtin-marketplaces.ts";
import {
  parseMarketplacePluginSource,
  pullHostPluginSourceVersions,
  readMarketplacePluginSource,
  resolveMarketplaceCloneUrl,
} from "../../src/services/host-plugin-source.ts";
import {
  hostPluginPullUnavailableReason,
  listHostPluginVersions,
  missingMarketplacePullMessage,
  pullHostPluginVersions,
} from "../../src/services/host-plugin-versions.ts";
import { pluginResourceShowExtras } from "../../src/services/plugin-resource-show.ts";
import { listVisibleMarketplaces } from "../../src/services/host-marketplaces.ts";
import { createResource } from "../../src/models/resource.ts";
import { runCommandWithTimeout } from "../../src/utils/run-command-with-timeout.ts";

function git(cwd: string, args: string): void {
  execSync(`git -c user.email=test@example.com -c user.name=Test ${args}`, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeCursorMarketplaceRepo(root: string): void {
  mkdirSync(join(root, ".cursor-plugin"), { recursive: true });
  mkdirSync(join(root, "teaching", ".cursor-plugin"), { recursive: true });
  mkdirSync(join(root, "third_party", "gmail", ".cursor-plugin"), { recursive: true });
  writeFileSync(
    join(root, ".cursor-plugin", "marketplace.json"),
    JSON.stringify({
      name: "cursor-plugins",
      plugins: [
        { name: "teaching", source: "teaching", description: "Skill mapping" },
        { name: "gmail", source: "third_party/gmail" },
      ],
    }),
  );
  writeFileSync(
    join(root, "teaching", ".cursor-plugin", "plugin.json"),
    JSON.stringify({ name: "teaching", version: "1.2.0" }),
  );
  writeFileSync(
    join(root, "third_party", "gmail", ".cursor-plugin", "plugin.json"),
    JSON.stringify({ name: "gmail", version: "0.4.0" }),
  );
}

describe("cursor-public builtin marketplace", () => {
  it("exposes the github.com/cursor/plugins git URL", () => {
    expect(builtinMarketplaceGitUrl("cursor-public")).toBe(CURSOR_PUBLIC_GIT_URL);
    expect(builtinMarketplaceGitUrl("acme-plugins")).toBeNull();
    expect(CURSOR_PUBLIC_GIT_URL).toBe("https://github.com/cursor/plugins.git");
  });

  it("does not treat cursor-public as uninstalled for Pull", async () => {
    const ctx = await createInitializedTestContext("cursor-public-pull-reason");
    try {
      expect(hostPluginPullUnavailableReason("teaching@cursor-public", ctx.homeDir)).toBeNull();
      expect(resolveMarketplaceCloneUrl(ctx.homeDir, CURSOR_PUBLIC_MARKETPLACE)).toBe(
        CURSOR_PUBLIC_GIT_URL,
      );
      expect(hostPluginPullUnavailableReason("demo@missing-mkt", ctx.homeDir)).toBe(
        "Marketplace missing-mkt is not installed",
      );
      expect(hostPluginPullUnavailableReason("local-only", ctx.homeDir)).toBe(
        missingMarketplacePullMessage("local-only"),
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it("reads Cursor marketplace.json relative sources and Cursor cache versions", async () => {
    const ctx = await createInitializedTestContext("cursor-public-source");
    try {
      const marketplaceRoot = join(
        ctx.homeDir,
        ".claude",
        "plugins",
        "marketplaces",
        "cursor-public",
      );
      writeCursorMarketplaceRepo(marketplaceRoot);
      const cursorCache = join(
        ctx.homeDir,
        ".cursor",
        "plugins",
        "cache",
        "cursor-public",
        "teaching",
        "d884ae04",
      );
      mkdirSync(join(cursorCache, ".cursor-plugin"), { recursive: true });
      writeFileSync(
        join(cursorCache, ".cursor-plugin", "plugin.json"),
        JSON.stringify({ name: "teaching", version: "1.1.0" }),
      );

      expect(
        parseMarketplacePluginSource({ name: "teaching", source: "teaching" }),
      ).toMatchObject({ path: "teaching", url: null });
      expect(
        readMarketplacePluginSource(ctx.homeDir, "cursor-public", "teaching"),
      ).toMatchObject({ path: "teaching", version: null });
      expect(
        readMarketplacePluginSource(ctx.homeDir, "cursor-public", "gmail"),
      ).toMatchObject({ path: "third_party/gmail" });

      const info = listHostPluginVersions("teaching@cursor-public", ctx.homeDir);
      expect(info.available_versions.map((row) => row.version)).toContain("d884ae04");
      expect(info.available_versions.find((row) => row.version === "d884ae04")?.path).toBe(
        cursorCache,
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it("pulls versions from a cursor-public relative-source marketplace checkout", async () => {
    const ctx = await createInitializedTestContext("cursor-public-pull");
    const repo = createTempDir("cursor-public-repo-");
    try {
      git(repo, "init -b main");
      writeCursorMarketplaceRepo(repo);
      git(repo, "add -A");
      git(repo, "commit -m init");
      git(repo, "tag v1.2.0");

      const marketplaceRoot = join(
        ctx.homeDir,
        ".claude",
        "plugins",
        "marketplaces",
        "cursor-public",
      );
      mkdirSync(join(marketplaceRoot, ".."), { recursive: true });
      execSync(
        `git -c protocol.file.allow=always clone ${repo} ${marketplaceRoot}`,
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      mkdirSync(join(ctx.homeDir, ".claude", "plugins"), { recursive: true });
      writeFileSync(
        join(ctx.homeDir, ".claude", "plugins", "known_marketplaces.json"),
        JSON.stringify({
          "cursor-public": {
            source: { source: "url", url: `file://${repo}` },
            installLocation: marketplaceRoot,
          },
        }),
      );

      const snapshot = pullHostPluginSourceVersions({
        originRef: "teaching@cursor-public",
        homeRoot: ctx.homeDir,
      });
      expect(snapshot.advertised_version).toBe("1.2.0");
      expect(snapshot.git_refs["1.2.0"]).toBe("v1.2.0");

      const pulled = pullHostPluginVersions({
        originRef: "teaching@cursor-public",
        homeRoot: ctx.homeDir,
      });
      expect(pulled.advertised_version).toBe("1.2.0");
    } finally {
      cleanupDir(repo);
      await ctx.cleanup();
    }
  });

  it("shows the builtin marketplace URL on cursor-public plugin details", async () => {
    const ctx = await createInitializedTestContext("cursor-public-show");
    try {
      const pin = createResource({
        type: "plugin",
        name: "teaching",
        namespace: "cursor-public",
        description: "Plugin pin: teaching@cursor-public",
        content: "{}",
        metadata: {},
        source: "composition:plugin",
        origin_kind: "marketplace_link",
        origin_ref: "teaching@cursor-public",
      });
      const extras = pluginResourceShowExtras(pin, { homeRoot: ctx.homeDir });
      expect(extras?.marketplace_url).toBe(CURSOR_PUBLIC_GIT_URL);
      expect(extras?.pull_unavailable_reason).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });

  it("clones cursor-public from the builtin git URL without Cursor or Claude marketplace install", async () => {
    const ctx = await createInitializedTestContext("cursor-public-native-clone");
    const repo = createTempDir("cursor-public-native-repo-");
    try {
      git(repo, "init -b main");
      writeCursorMarketplaceRepo(repo);
      git(repo, "add -A");
      git(repo, "commit -m init");
      git(repo, "tag v1.2.0");

      const runCommand = (
        command: string,
        args: string[],
        options?: { cwd?: string; timeoutMs?: number },
      ) => {
        const mapped = args.map((arg) =>
          arg === CURSOR_PUBLIC_GIT_URL || arg === "https://github.com/cursor/plugins"
            ? repo
            : arg,
        );
        return runCommandWithTimeout(command, mapped, options);
      };

      expect(hostPluginPullUnavailableReason("teaching@cursor-public", ctx.homeDir)).toBeNull();

      const snapshot = pullHostPluginSourceVersions({
        originRef: "teaching@cursor-public",
        homeRoot: ctx.homeDir,
        runCommand,
      });
      expect(snapshot.advertised_version).toBe("1.2.0");
      expect(snapshot.source_url).toBe(CURSOR_PUBLIC_GIT_URL);
      expect(
        existsSync(
          join(
            ctx.homeDir,
            ".claude",
            "plugins",
            "marketplaces",
            "cursor-public",
            ".cursor-plugin",
            "marketplace.json",
          ),
        ),
      ).toBe(true);

      const known = JSON.parse(
        readFileSync(
          join(ctx.homeDir, ".claude", "plugins", "known_marketplaces.json"),
          "utf8",
        ),
      ) as Record<string, { source?: { source?: string; repo?: string }; installLocation?: string }>;
      expect(known["cursor-public"]).toMatchObject({
        source: { source: "github", repo: "cursor/plugins" },
      });
      expect(known["cursor-public"]?.installLocation).toContain(
        "marketplaces/cursor-public",
      );

      const pulled = pullHostPluginVersions({
        originRef: "teaching@cursor-public",
        homeRoot: ctx.homeDir,
        runCommand,
      });
      expect(pulled.advertised_version).toBe("1.2.0");
      expect(pulled.available_versions.map((row) => row.version)).toContain("1.2.0");

      const listed = listVisibleMarketplaces(
        join(ctx.homeDir, ".harnesstap"),
        ctx.homeDir,
      );
      const cursorPublic = listed.find((entry) => entry.name === CURSOR_PUBLIC_MARKETPLACE);
      expect(cursorPublic).toMatchObject({
        platforms: ["cursor", "claude-code"],
        managed: false,
      });
      expect(cursorPublic?.contentRoot).toContain("marketplaces/cursor-public");
    } finally {
      cleanupDir(repo);
      await ctx.cleanup();
    }
  });
});
