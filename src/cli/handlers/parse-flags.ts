export function parseHarnessAliases(aliases?: string): string[] | undefined {
  return aliases
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseCommaSeparatedList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function resolveAddScope(opts: {
  global?: boolean;
  project?: boolean | string;
}): { scope: "global" | "project"; projectRoot?: string } | undefined {
  if (opts.global && opts.project !== undefined) {
    throw new Error("Pass only one of --global or --project.");
  }
  if (opts.global) {
    return { scope: "global" };
  }
  if (opts.project !== undefined) {
    return {
      scope: "project",
      projectRoot: typeof opts.project === "string" ? opts.project : ".",
    };
  }
  return undefined;
}
