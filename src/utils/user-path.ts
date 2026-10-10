import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { resolveHomeRoot } from "./home-root.js";

export class UserPathError extends Error {
  readonly input: string;

  constructor(input: string, resolved: string) {
    super(`Directory not found: ${input}.`);
    this.name = "UserPathError";
    this.input = input;
    this.resolved = resolved;
  }

  readonly resolved: string;
}

export function expandUserPath(arg: string, home = resolveHomeRoot()): string {
  const trimmed = arg.trim();
  if (trimmed === "~") {
    return home;
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(home, trimmed.slice(2));
  }
  return isAbsolute(trimmed) ? trimmed : resolve(trimmed);
}

export function resolveUserPath(
  arg: string,
  opts?: { mustExist?: boolean; home?: string },
): string {
  const resolved = resolve(expandUserPath(arg, opts?.home ?? resolveHomeRoot()));
  if (opts?.mustExist && !existsSync(resolved)) {
    throw new UserPathError(arg, resolved);
  }
  return resolved;
}
