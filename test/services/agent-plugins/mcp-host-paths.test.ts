import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse } from "smol-toml";
import { getHarnesstapDir } from "../../../src/db/connection.ts";
import { createPlugin, getPluginByName, getPluginResources } from "../../../src/models/plugin-model.ts";
import { getResource } from "../../../src/models/resource.ts";
import { CodexSerializer } from "../../../src/platforms/codex.ts";
import { importApPackageFiles } from "../../../src/services/agent-plugins/import.ts";
import {
  installAgentPluginPackage,
  pluginInstallRootPath,
} from "../../../src/services/agent-plugins/install-root.ts";
import {
  resolveInstalledMcpResources,
  resolvePluginRelativePath,
} from "../../../src/services/agent-plugins/mcp-host-paths.ts";
import { resolvePluginPackageRoot } from "../../../src/services/agent-plugins/package-root.ts";
import { readContainedPackageFiles } from "../../../src/services/agent-plugins/spec-load.ts";
import { generateFiles } from "../../../src/services/applier.ts";
import { refreshMarketplaceCatalog } from "../../../src/services/marketplace-catalog.ts";
import { addMarketplace } from "../../../src/services/marketplace-registry.ts";
import { addPluginAttachment } from "../../../src/services/plugin-composition.ts";
import { addDependency } from "../../../src/services/plugin-dependency.ts";
import { importPluginFromGitHubRef } from "../../../src/services/plugin-git-import.ts";
import { syncPluginResource } from "../../../src/services/resource-sync.ts";
import { materializeUpstreamPlugin } from "../../../src/services/upstream-plugin.ts";
import type { McpServerMetadata, Resource } from "../../../src/types.ts";
import { createInitializedTestContext } from "../../helpers/db.ts";
import { makeResource } from "../../helpers/resources.ts";

const CORE = join(
  import.meta.dirname,
  "../../fixtures/agent-plugins-spec/conformance/agent-plugins-conformance-core",
);

function server(
  document: { mcpServers: Record<string, Record<string, unknown>> },
  name: string,
): Record<string, unknown> {
  const entry = document.mcpServers[name];
  if (!entry) throw new Error(`missing server ${name}`);
  return entry;
}

function commitRepo(repo: string): void {
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: repo, stdio: "ignore" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  };
  git(["init"]);
  git(["add", "."]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"]);
}

async function expectHostExpansion(
  resources: Resource[],
  homeDir: string,
  root: string,
): Promise<void> {
  const generated = await generateFiles(
    resources,
    ["claude-code", "codex", "copilot-cli"],
    homeDir,
    { target: "global" },
  );
  const byPlatform = new Map(generated.map((result) => [result.platformId, result.files]));
  const claude = JSON.parse(
    byPlatform.get("claude-code")?.find((file) => file.path === ".claude.json")?.content ?? "{}",
  ) as { mcpServers: Record<string, Record<string, unknown>> };
  const copilot = JSON.parse(
    byPlatform.get("copilot-cli")?.find((file) => file.path === ".copilot/mcp-config.json")?.content ??
      "{}",
  ) as { mcpServers: Record<string, Record<string, unknown>> };
  const codex = parse(
    byPlatform.get("codex")?.find((file) => file.path === ".codex/config.toml")?.content ?? "",
  ) as { mcp_servers: Record<string, Record<string, unknown>> };
  const probe = `${root}/dist/probe.mjs`;
  const token = `${root}/bin/posix/probe token.sh`;
  const workdir = `${root}/probe-workdir`;
  for (const document of [claude, copilot]) {
    expect(server(document, "default").args).toContain(probe);
    expect(server(document, "default").args).not.toContain("${PLUGIN_ROOT}/dist/probe.mjs");
    expect(server(document, "relative").cwd).toBe(workdir);
    expect(server(document, "command-token-posix").command).toBe(token);
  }
  expect(codex.mcp_servers.default?.args).toContain(probe);
  expect(codex.mcp_servers.default?.args).not.toContain("${PLUGIN_ROOT}/dist/probe.mjs");
  expect(codex.mcp_servers.relative?.cwd).toBe(workdir);
  expect(codex.mcp_servers["command-token-posix"]?.command).toBe(token);
  const stored = resources.find((resource) => resource.type === "mcp_server" && resource.name === "default");
  if (!stored) throw new Error("missing default server");
  expect((getResource(stored.id)?.metadata as McpServerMetadata).args?.[0]).toBe(
    "${PLUGIN_ROOT}/dist/probe.mjs",
  );
}

describe("installed agent plugin MCP paths", () => {
  it("keeps a spaced relative command as one token", () => {
    expect(resolvePluginRelativePath("./bin/posix/probe token.sh", "/opt/my plugins/core")).toBe(
      "/opt/my plugins/core/bin/posix/probe token.sh",
    );
    expect(resolvePluginRelativePath("node", "/opt/core")).toBe("node");
    expect(resolvePluginRelativePath("./../outside", "/opt/core")).toBe("./../outside");
  });

  it("quotes a Windows path with spaces as one TOML string", async () => {
    const serializer = new CodexSerializer();
    const command = String.raw`C:\Program Files\probe token.sh`;
    const files = await serializer.serialize(
      [
        makeResource({
          type: "mcp_server",
          name: "spaced",
          metadata: {
            transport: "stdio",
            command,
            cwd: String.raw`C:\Program Files\work`,
          },
        }),
      ],
      "/tmp/project",
      { target: "project" },
    );
    const config = files.find((file) => file.path.endsWith("config.toml"));
    if (!config) throw new Error("missing codex config");
    const parsed = parse(config.content) as {
      mcp_servers: { spaced: { command: string; cwd: string } };
    };
    expect(parsed.mcp_servers.spaced.command).toBe(command);
    expect(parsed.mcp_servers.spaced.cwd).toBe(String.raw`C:\Program Files\work`);
    expect(config.content).toContain(JSON.stringify(command));
  });

  it("expands host MCP configs and leaves the library copy literal", async () => {
    const context = await createInitializedTestContext("mcp-host-paths");
    try {
      const plugin = importApPackageFiles(readContainedPackageFiles(CORE));
      const installed = pluginInstallRootPath(plugin.name, plugin.version);
      const commandPath = join(installed, "bin", "posix", "probe token.sh");
      expect(existsSync(commandPath)).toBe(true);
      expect(readFileSync(commandPath, "utf8").length).toBeGreaterThan(0);

      const before = getPluginResources(plugin.id).find(
        (resource) => resource.type === "mcp_server" && resource.name === "default",
      );
      if (!before) throw new Error("missing default server");
      const beforeMeta = before.metadata as McpServerMetadata;
      expect(beforeMeta.args?.[0]).toBe("${PLUGIN_ROOT}/dist/probe.mjs");

      const generated = await generateFiles(
        getPluginResources(plugin.id),
        ["claude-code", "cursor", "codex", "copilot-cli"],
        context.homeDir,
        { target: "global" },
      );
      const byPlatform = new Map(generated.map((result) => [result.platformId, result.files]));

      const claude = JSON.parse(
        byPlatform.get("claude-code")?.find((file) => file.path === ".claude.json")?.content ?? "{}",
      ) as { mcpServers: Record<string, Record<string, unknown>> };
      const cursor = JSON.parse(
        byPlatform.get("cursor")?.find((file) => file.path === ".cursor/mcp.json")?.content ?? "{}",
      ) as { mcpServers: Record<string, Record<string, unknown>> };
      const copilot = JSON.parse(
        byPlatform.get("copilot-cli")?.find((file) => file.path === ".copilot/mcp-config.json")?.content ??
          "{}",
      ) as { mcpServers: Record<string, Record<string, unknown>> };
      const codex = parse(
        byPlatform.get("codex")?.find((file) => file.path === ".codex/config.toml")?.content ?? "",
      ) as { mcp_servers: Record<string, Record<string, unknown>> };

      const dataDir = join(context.homeDir, ".harnesstap", "plugin-data", plugin.name);
      const probeArg = `${installed}/dist/probe.mjs`;
      for (const document of [claude, cursor, copilot]) {
        const entry = server(document, "default");
        expect(entry.args).toContain(probeArg);
        expect(entry.args).toContain(installed);
        expect(entry.args).toContain(dataDir);
        expect(entry.args).toContain("${APC_UNKNOWN}");
        expect(entry.args).toContain("$APC_VALUE");
        expect(entry.args).toContain("${PLUGIN_ROOT_SUFFIX}");
        const env = entry.env as Record<string, string>;
        expect(env.APC_EXPANSION).toBe(`${installed}|${dataDir}|${installed}`);
        expect(env.APC_LITERAL).toBe("${APC_UNKNOWN}|$APC_VALUE|${PLUGIN_ROOT_SUFFIX}");
      }
      expect(codex.mcp_servers.default?.args).toContain(probeArg);
      expect(codex.mcp_servers.default?.args).toContain("${PLUGIN_ROOT_SUFFIX}");

      const token = `${installed}/bin/posix/probe token.sh`;
      expect(server(claude, "command-token-posix").command).toBe(token);
      expect(server(cursor, "command-token-posix").command).toBe(token);
      expect(server(copilot, "command-token-posix").command).toBe(token);
      expect(codex.mcp_servers["command-token-posix"]?.command).toBe(token);

      const workdir = `${installed}/probe-workdir`;
      expect(server(claude, "relative").cwd).toBe(workdir);
      expect(server(claude, "root").cwd).toBe(workdir);
      expect(server(claude, "data").cwd).toBe(dataDir);
      expect(server(copilot, "relative").cwd).toBe(workdir);
      expect(codex.mcp_servers.relative?.cwd).toBe(workdir);
      expect(codex.mcp_servers.data?.cwd).toBe(dataDir);
      expect(server(cursor, "relative").cwd).toBeUndefined();
      expect(server(cursor, "command-token-posix").command).toBe(token);

      const cursorWarnings = generated.find((result) => result.platformId === "cursor")?.surface_warnings ?? [];
      expect(cursorWarnings.some((warning) => warning.message.includes("cwd is not written"))).toBe(true);
      const claudeWarnings = generated.find((result) => result.platformId === "claude-code")?.surface_warnings ?? [];
      expect(claudeWarnings.some((warning) => warning.message.includes("cwd is not written"))).toBe(false);

      const stored = getResource(before.id);
      expect((stored?.metadata as McpServerMetadata).args?.[0]).toBe("${PLUGIN_ROOT}/dist/probe.mjs");
      expect((stored?.metadata as McpServerMetadata).command).toBe("node");
    } finally {
      await context.cleanup();
    }
  });

  it("expands a marketplace install from .agents/plugins/marketplace.json", async () => {
    const context = await createInitializedTestContext("mcp-mkt-paths");
    try {
      const repo = mkdtempSync(join(tmpdir(), "ht-mkt-apcc-"));
      cpSync(CORE, join(repo, "plugins", "apcc"), { recursive: true });
      mkdirSync(join(repo, ".agents", "plugins"), { recursive: true });
      writeFileSync(
        join(repo, ".agents", "plugins", "marketplace.json"),
        `${JSON.stringify({
          name: "mkt",
          plugins: [
            {
              name: "apcc",
              source: { source: "local", path: "./plugins/apcc" },
              version: "0.1.0",
            },
          ],
        })}\n`,
      );
      commitRepo(repo);
      addMarketplace(getHarnesstapDir(), {
        name: "mkt",
        url: repo,
        platforms: ["claude-code"],
      });
      const refresh = await refreshMarketplaceCatalog(getHarnesstapDir(), { name: "mkt", force: true });
      expect(refresh.ok).toBe(true);
      const wrapper = createPlugin({ name: "wrapper", version: "1.0.0" });
      await addPluginAttachment({
        plugin: wrapper,
        selector: "plugin:apcc@mkt",
        type: "plugin",
        sync: true,
      });
      const plugin = getPluginByName("apcc", "0.1.0") ?? getPluginByName("apcc");
      if (!plugin) throw new Error("missing marketplace plugin apcc");
      const root = resolvePluginPackageRoot(plugin);
      if (!root) throw new Error("missing marketplace package root");
      expect(existsSync(join(root, "bin", "posix", "probe token.sh"))).toBe(true);
      expect(
        root.includes(`${join("cache", "packages", "host-plugin")}`)
          || root.includes(`${join("cache", "marketplaces", "mkt")}`),
      ).toBe(true);
      await expectHostExpansion(getPluginResources(plugin.id), context.homeDir, root);
    } finally {
      await context.cleanup();
    }
  });

  it("expands a git install", async () => {
    const context = await createInitializedTestContext("mcp-git-paths");
    try {
      const source = mkdtempSync(join(tmpdir(), "ht-git-apcc-"));
      cpSync(CORE, source, { recursive: true });
      const imported = await importPluginFromGitHubRef("acme/apcc", {
        refreshGit: (opts) => {
          mkdirSync(opts.targetDir, { recursive: true });
          cpSync(source, opts.targetDir, { recursive: true });
          return { ok: true, sha: "abc123def456", message: "ok" };
        },
      });
      const plugin = getPluginByName(imported.plugin.name, imported.plugin.version) ?? imported.plugin;
      const root = resolvePluginPackageRoot(plugin);
      if (!root) throw new Error("missing git package root");
      expect(existsSync(join(root, "bin", "posix", "probe token.sh"))).toBe(true);
      expect(
        root.includes(`${join("cache", "packages", "host-plugin")}`)
          || root.includes(`${join("cache", "git-origins")}`),
      ).toBe(true);
      await expectHostExpansion(getPluginResources(plugin.id), context.homeDir, root);
    } finally {
      await context.cleanup();
    }
  });

  it("expands a local install tree", async () => {
    const context = await createInitializedTestContext("mcp-local-paths");
    try {
      const root = join(context.homeDir, ".agents", "plugins", "apcc");
      cpSync(CORE, root, { recursive: true });
      const wrapper = createPlugin({ name: "wrapper", version: "1.0.0" });
      const pin = addDependency(wrapper.id, "apcc");
      await syncPluginResource(pin, { policy: "overwrite" });
      const synced = getResource(pin.id);
      const version = (synced?.metadata as { resolved_version?: string }).resolved_version;
      if (!version) throw new Error("local pin has no resolved version");
      const plugin = materializeUpstreamPlugin({ ref: "apcc", name: "apcc", version });
      const resolved = resolvePluginPackageRoot(plugin);
      expect(resolved).toBe(root);
      await expectHostExpansion(getPluginResources(plugin.id), context.homeDir, root);
    } finally {
      await context.cleanup();
    }
  });

  it("writes the POSIX server on linux and the Windows server on win32", async () => {
    const context = await createInitializedTestContext("mcp-platform-server");
    try {
      const resources = [
        makeResource({
          type: "mcp_server",
          name: "command-token-posix",
          metadata: { transport: "stdio", command: "./bin/posix/probe token.sh" },
        }),
        makeResource({
          type: "mcp_server",
          name: "command-token-windows",
          metadata: { transport: "stdio", command: "./bin/windows/probe token.cmd" },
        }),
        makeResource({
          type: "mcp_server",
          name: "default",
          metadata: { transport: "stdio", command: "node" },
        }),
      ];
      const linux = resolveInstalledMcpResources(resources, { platform: "linux" });
      expect(linux.resources.map((resource) => resource.name)).toEqual([
        "command-token-posix",
        "default",
      ]);
      const darwin = resolveInstalledMcpResources(resources, { platform: "darwin" });
      expect(darwin.resources.map((resource) => resource.name)).toEqual([
        "command-token-posix",
        "default",
      ]);
      const win = resolveInstalledMcpResources(resources, { platform: "win32" });
      expect(win.resources.map((resource) => resource.name)).toEqual([
        "command-token-windows",
        "default",
      ]);
      expect(resources.map((resource) => resource.name)).toEqual([
        "command-token-posix",
        "command-token-windows",
        "default",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("does not replace an unowned install file and backs up an owned removal", async () => {
    const context = await createInitializedTestContext("mcp-install-ownership");
    try {
      const root = pluginInstallRootPath("agent-plugins-conformance-core", "0.1.0");
      const userFile = join(root, "mcp.json");
      mkdirSync(root, { recursive: true });
      writeFileSync(userFile, "user kept\n", "utf8");

      const first = installAgentPluginPackage(
        { name: "agent-plugins-conformance-core", version: "0.1.0" },
        readContainedPackageFiles(CORE),
      );
      expect(readFileSync(userFile, "utf8")).toBe("user kept\n");
      expect(first.warnings.some((warning) => warning.includes("not owned"))).toBe(true);
      const owned = join(root, "bin", "posix", "probe token.sh");
      expect(existsSync(owned)).toBe(true);
      const mode = statSync(owned).mode;
      expect(mode & 0o111).not.toBe(0);

      const seeded = installAgentPluginPackage(
        { name: "agent-plugins-conformance-core", version: "0.1.0" },
        {
          ...readContainedPackageFiles(CORE),
          "notes.txt": { encoding: "utf8", content: "owned note\n" },
        },
      );
      expect(seeded.warnings.every((warning) => warning.includes("mcp.json"))).toBe(true);
      expect(readFileSync(join(root, "notes.txt"), "utf8")).toBe("owned note\n");

      writeFileSync(join(root, "notes.txt"), "user edited\n", "utf8");
      const edited = installAgentPluginPackage(
        { name: "agent-plugins-conformance-core", version: "0.1.0" },
        readContainedPackageFiles(CORE),
      );
      expect(readFileSync(join(root, "notes.txt"), "utf8")).toBe("user edited\n");
      expect(edited.warnings.some((warning) => warning.includes("was changed"))).toBe(true);

      const removed = installAgentPluginPackage(
        { name: "agent-plugins-conformance-core", version: "0.1.0" },
        { "plugin.json": { encoding: "utf8", content: "{}\n" } },
      );
      expect(existsSync(owned)).toBe(false);
      expect(removed.backedUp).toContain("bin/posix/probe token.sh");
      expect(readFileSync(userFile, "utf8")).toBe("user kept\n");
      const backups = context.connection
        .getDb()
        .prepare("SELECT relative_path, content FROM apply_removal_backups")
        .all() as Array<{ relative_path: string; content: Buffer | string }>;
      expect(backups.some((row) => row.relative_path === "bin/posix/probe token.sh")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
