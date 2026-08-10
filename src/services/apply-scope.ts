import { resolve } from "node:path";
import type { PlatformPaths } from "../types.js";
import { getPlatform } from "../platforms/registry.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { ui } from "../ui/index.js";

export type ApplyScope = "project" | "global";

export interface ResolvedApplyScope {
  scope: ApplyScope;
  /** Project root for `project`, home root for `global`. */
  root: string;
  /** First line of output, printed in TTY and non-TTY runs alike. */
  destinationLine: string;
}

export function resolveApplyScope(input: {
  global?: boolean;
  project?: string;
  platforms: string[];
}): ResolvedApplyScope {
  if (input.global) {
    const home = resolveHomeRoot();
    const paths = input.platforms
      .map((id) => getPlatform(id))
      .filter((platform): platform is NonNullable<typeof platform> => platform != null)
      .map((platform) => topLevelGlobalPath(platform.globalPaths))
      .filter((path, index, all) => path !== "" && all.indexOf(path) === index);
    return {
      scope: "global",
      root: home,
      destinationLine: `→ machine home ${paths.map((p) => `~/${p}`).join(", ")}`.trimEnd(),
    };
  }
  const root = resolve(input.project ?? ".");
  return { scope: "project", root, destinationLine: `→ project ${root}` };
}

function topLevelGlobalPath(paths: PlatformPaths): string {
  for (const value of Object.values(paths)) {
    if (typeof value !== "string" || !value) continue;
    const normalized = value.replace(/^~\//, "");
    const segment = normalized.split("/")[0];
    if (segment && segment.startsWith(".")) return segment;
  }
  return "";
}

export function printDestination(resolved: ResolvedApplyScope): void {
  console.log(ui.theme.muted(resolved.destinationLine));
}
