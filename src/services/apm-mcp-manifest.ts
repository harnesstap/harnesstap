import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { APM_MANIFEST_FILENAME, parseApmYamlDocument } from "./apm-manifest.js";
import { collectApmAndDevDependencies } from "./apm-dependencies.js";
import { splitMcpRegistryIdentity } from "./mcp-registry.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function apmManifestPath(projectRoot: string): string {
  return join(projectRoot, APM_MANIFEST_FILENAME);
}

export function manifestHasMcpRegistryId(raw: string, registryId: string): boolean {
  const document = parseApmYamlDocument(raw, APM_MANIFEST_FILENAME);
  const { name } = splitMcpRegistryIdentity(registryId);
  const deps = collectApmAndDevDependencies(document);
  return deps.mcp.some((entry) => {
    if (entry.registryId === registryId || entry.registryId === name) {
      return true;
    }
    return entry.raw === registryId || entry.raw === name;
  });
}

export function appendMcpRegistryIdToManifest(
  raw: string,
  registryId: string,
): { next: string; added: boolean } {
  if (manifestHasMcpRegistryId(raw, registryId)) {
    return { next: raw, added: false };
  }
  const document = parseApmYamlDocument(raw, APM_MANIFEST_FILENAME);
  const dependencies = isRecord(document.dependencies) ? { ...document.dependencies } : {};
  const existing = dependencies.mcp;
  const mcp = Array.isArray(existing) ? [...existing, registryId] : [registryId];
  document.dependencies = { ...dependencies, mcp };
  return {
    next: stringifyYaml(document, {
      indent: 2,
      lineWidth: 0,
      defaultKeyType: "PLAIN",
    }),
    added: true,
  };
}

export async function withMcpManifestAppend(options: {
  projectRoot: string;
  registryId: string;
  dryRun?: boolean;
  run: () => Promise<void>;
}): Promise<{ added: boolean }> {
  const path = apmManifestPath(options.projectRoot);
  if (!existsSync(path)) {
    throw new Error(
      `No ${APM_MANIFEST_FILENAME} found under ${options.projectRoot}. Run ht config init first.`,
    );
  }
  const previous = readFileSync(path, "utf8");
  const { next, added } = appendMcpRegistryIdToManifest(previous, options.registryId);
  if (added) {
    writeFileSync(path, next, "utf8");
  }
  const restore = (): void => {
    if (added) {
      writeFileSync(path, previous, "utf8");
    }
  };
  try {
    await options.run();
    if ((process.exitCode ?? 0) !== 0 || options.dryRun) {
      restore();
    }
    return { added };
  } catch (error) {
    restore();
    throw error;
  }
}
