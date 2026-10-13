import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { startAgentServer } from "../../src/agent/serve.ts";
import { createResource } from "../../src/models/resource.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import {
  ensureMarketplaceCatalog,
  MARKETPLACE_CATALOG_MAX_AGE_MS,
  marketplaceCatalogPath,
  refreshMarketplaceCatalog,
} from "../../src/services/marketplace-catalog.ts";
import { inflightCommandCount, stopInflightCommands } from "../../src/utils/spawn-command.ts";

const tempDirs: string[] = [];

function keep(dir: string): string {
  tempDirs.push(dir);
  return dir;
}

async function main(): Promise<void> {
  const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  if (!realGit) {
    throw new Error("git was not found");
  }
  const previousPath = process.env.PATH ?? "";
  const home = keep(mkdtempSync(join(tmpdir(), "ht-detail-hang-")));
  process.env.HARNESSTAP_HOME = home;
  process.env.HOME = home;
  process.env.USERPROFILE = home;

  const repo = keep(mkdtempSync(join(tmpdir(), "ht-detail-hang-repo-")));
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "local-market",
      plugins: [{ name: "alpha", version: "1.0.0" }],
    }),
  );
  for (const args of [
    ["init"],
    ["add", "."],
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"],
    ["branch", "-M", "main"],
  ]) {
    const result = spawnSync(realGit, args, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr || `git ${args.join(" ")} failed`);
    }
  }

  const server = await startAgentServer({ port: 0 });
  try {
    addMarketplace(home, {
      name: "local-market",
      url: repo,
      platforms: ["claude-code"],
    });
    const primed = await refreshMarketplaceCatalog(home, {
      name: "local-market",
      force: true,
      unattended: false,
    });
    if (!primed.ok) {
      throw new Error(primed.message);
    }

    const catalogPath = marketplaceCatalogPath(home, "local-market");
    const stale = (Date.now() - MARKETPLACE_CATALOG_MAX_AGE_MS - 1_000) / 1000;
    utimesSync(catalogPath, stale, stale);

    createResource({
      type: "skill",
      name: "ship",
      description: "Ship skill",
      content: "# ship",
      metadata: {},
      source: "manual",
    });

    const bin = keep(mkdtempSync(join(tmpdir(), "ht-fake-git-")));
    const fakeGit = join(bin, "git");
    writeFileSync(
      fakeGit,
      `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    fetch|clone|ls-remote)
      sleep 30
      exit 0
      ;;
  esac
done
exec ${JSON.stringify(realGit)} "$@"
`,
    );
    chmodSync(fakeGit, 0o755);
    process.env.PATH = `${bin}:${previousPath}`;

    const ensureStarted = performance.now();
    const cached = await ensureMarketplaceCatalog(home, { name: "local-market" });
    const ensureMs = performance.now() - ensureStarted;
    if (cached.map((plugin) => plugin.name).join(",") !== "alpha") {
      throw new Error(`cached catalog was ${cached.map((plugin) => plugin.name).join(",")}`);
    }
    if (ensureMs >= 500) {
      throw new Error(`ensure took ${ensureMs.toFixed(1)}ms`);
    }

    const deadline = Date.now() + 2_000;
    while (inflightCommandCount() === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (inflightCommandCount() === 0) {
      throw new Error("expected a hanging git child");
    }

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    const detailStarted = performance.now();
    const detail = await fetch(
      `${server.url}/v1/library/resources/${encodeURIComponent("skill:ship")}`,
      { headers: { authorization: `Bearer ${server.token}` } },
    );
    const detailMs = performance.now() - detailStarted;
    console.log = originalLog;
    if (detail.status !== 200) {
      throw new Error(`detail status ${detail.status}`);
    }
    const body = await detail.json() as { resource?: { content?: string }; content?: string };
    const content = body.content ?? body.resource?.content;
    if (content !== "# ship") {
      throw new Error(`detail content ${JSON.stringify(body)}`);
    }
    if (detailMs >= 500) {
      throw new Error(`detail took ${detailMs.toFixed(1)}ms`);
    }
    const timed = logs.some((line) =>
      line.startsWith("[ht-agent] GET ")
      && line.includes("/v1/library/resources/")
      && line.includes(" 200 ")
      && line.endsWith("ms"),
    );
    if (!timed) {
      throw new Error(`missing request timing log: ${logs.join(" | ")}`);
    }
    process.stdout.write(`ensureMs=${ensureMs.toFixed(1)} detailMs=${detailMs.toFixed(1)}\n`);
  } finally {
    stopInflightCommands();
    server.stop();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  stopInflightCommands();
  process.exit(1);
});
