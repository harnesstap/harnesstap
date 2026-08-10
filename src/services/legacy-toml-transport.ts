/** Suffixes for deleted TOML transport formats (kept for clear rejection errors). */
const LEGACY_PLUGIN_SUFFIX = `.harnesstap${".toml"}`;
const LEGACY_ENVIRONMENT_SUFFIX = `.environment${".toml"}`;

export function isLegacyPluginTomlPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(LEGACY_PLUGIN_SUFFIX);
}

export function isLegacyEnvironmentTomlPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(LEGACY_ENVIRONMENT_SUFFIX);
}

export function isLegacyTomlTransportPath(filePath: string): boolean {
  return isLegacyPluginTomlPath(filePath) || isLegacyEnvironmentTomlPath(filePath);
}

export function legacyTomlTransportRejection(filePath: string): string {
  return (
    `${filePath} is a HarnessTap TOML transport file, which is no longer supported. ` +
    "Portable artifacts are Agent Plugins packages: a directory with a plugin.json, " +
    "or a single .ap.json envelope."
  );
}
