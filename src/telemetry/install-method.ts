export type CliInstallMethod = "brew" | "npm" | "bun" | "npx" | "curl" | "unknown";

const INSTALL_METHODS = new Set<CliInstallMethod>([
  "brew",
  "npm",
  "bun",
  "npx",
  "curl",
  "unknown",
]);

function isCliInstallMethod(value: string): value is CliInstallMethod {
  return INSTALL_METHODS.has(value as CliInstallMethod);
}

export function detectCliInstallMethod(): CliInstallMethod {
  const override = process.env.HARNESSTAP_INSTALL_METHOD?.trim().toLowerCase();
  if (override && isCliInstallMethod(override)) {
    return override;
  }

  const haystack = [
    process.execPath,
    process.argv[1] ?? "",
    process.env.npm_execpath ?? "",
    process.env.npm_command ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes("npx")) {
    return "npx";
  }
  if (haystack.includes("/cellar/") || haystack.includes("homebrew")) {
    return "brew";
  }
  if (haystack.includes("bun")) {
    return "bun";
  }
  if (
    haystack.includes("node_modules")
    || haystack.includes("npm")
    || (process.execPath.toLowerCase().includes("node") && haystack.includes("harnesstap"))
  ) {
    return "npm";
  }
  return "unknown";
}
