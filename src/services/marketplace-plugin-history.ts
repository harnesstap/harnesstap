import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCommandResult, type RunCommand } from "../plugins/run-command.js";
import { runCommandWithTimeout } from "../utils/run-command-with-timeout.js";

/** Manifest-touching commits read before giving up on an old version. */
const MAX_COMMITS = 200;

function manifestPaths(sourcePath: string): string[] {
  const base = sourcePath.replace(/^\.\//, "").replace(/\/+$/, "");
  const prefix = base && base !== "." ? `${base}/` : "";
  return [`${prefix}.claude-plugin/plugin.json`, `${prefix}plugin.json`];
}

function declaredVersion(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export type PluginHistoryCheckout =
  | { ok: true; commit: string }
  | { ok: false; message: string };

/**
 * Find the commit of a marketplace repository at which a plugin's
 * plugin.json declared `version`, and write the plugin tree as of that commit
 * to `targetDir`. Used when the marketplace head no longer declares the
 * version a profile pins (claude-plugins-official dropped `version` from
 * playwright's plugin.json). Reads a blobless clone, so only the manifests
 * and the one tree are downloaded.
 */
export async function checkoutPluginVersionFromHistory(input: {
  /** The marketplace checkout; its `origin` is cloned. */
  checkoutDir: string;
  /** Plugin directory inside the marketplace repository (`./external_plugins/x`). */
  sourcePath: string;
  version: string;
  targetDir: string;
  runCommand?: RunCommand;
}): Promise<PluginHistoryCheckout> {
  const run = input.runCommand ?? runCommandWithTimeout;
  const git = (args: string[], cwd?: string) =>
    resolveCommandResult(run("git", args, cwd ? { cwd } : undefined));

  const origin = await git(["remote", "get-url", "origin"], input.checkoutDir);
  const url = origin.stdout.trim();
  if (origin.exitCode !== 0 || !url) {
    return { ok: false, message: "the marketplace checkout has no origin to read history from" };
  }

  const scratch = mkdtempSync(join(tmpdir(), "ht-plugin-history-"));
  try {
    const history = join(scratch, "history");
    const clone = await git(["clone", "--quiet", "--filter=blob:none", "--no-checkout", url, history]);
    if (clone.exitCode !== 0) {
      return { ok: false, message: clone.stderr.trim() || `git clone ${url} failed` };
    }
    for (const manifest of manifestPaths(input.sourcePath)) {
      const log = await git(
        ["log", `--max-count=${MAX_COMMITS}`, "--format=%H", "--", manifest],
        history,
      );
      if (log.exitCode !== 0) continue;
      for (const commit of log.stdout.split("\n").map((line) => line.trim()).filter(Boolean)) {
        const shown = await git(["show", `${commit}:${manifest}`], history);
        if (shown.exitCode !== 0 || declaredVersion(shown.stdout) !== input.version) continue;
        const pluginDir = manifest.replace(/(\.claude-plugin\/)?plugin\.json$/, "").replace(/\/$/, "");
        // One shallow fetch of that commit brings its whole tree in a single
        // pack; checking it out of the blobless clone would fetch blob by blob.
        const tree = join(scratch, "tree");
        mkdirSync(tree, { recursive: true });
        for (const args of [
          ["init", "--quiet"],
          ["fetch", "--quiet", "--depth=1", url, commit],
          ["checkout", "--quiet", "FETCH_HEAD"],
        ]) {
          const step = await git(args, tree);
          if (step.exitCode !== 0) {
            return { ok: false, message: step.stderr.trim() || `git ${args[0]} for ${commit} failed` };
          }
        }
        const source = pluginDir ? join(tree, pluginDir) : tree;
        if (!existsSync(source)) continue;
        rmSync(input.targetDir, { recursive: true, force: true });
        mkdirSync(input.targetDir, { recursive: true });
        cpSync(source, input.targetDir, {
          recursive: true,
          verbatimSymlinks: true,
          filter: (path) => !path.startsWith(join(tree, ".git")),
        });
        return { ok: true, commit };
      }
    }
    return { ok: false, message: `no commit declares version ${input.version}` };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
