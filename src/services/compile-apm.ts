import type { Resource } from "../types.js";
import { generateFiles, materializeFiles } from "./applier.js";
import {
  inspectApmOverlay,
  type ApmOverlayInfo,
} from "./apm-overlay.js";
import {
  COMPILE_NO_TARGET_HINT,
  resolveCompileTargets,
  type ResolveCompileTargetsInput,
  type ResolvedCompileTargets,
} from "./apm-targets.js";
import { gateDeployFiles } from "./deploy-gate.js";
import type { UnicodeScanFinding } from "./unicode-scan.js";
import { findProjectConfig } from "./project-config.js";

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileError";
  }
}

export interface CompileApmOptions {
  projectRoot: string;
  cliTarget?: string;
  cliAll?: boolean;
  cliHarness?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface CompiledHarnessFiles {
  platformId: string;
  files: Array<{ path: string; content: string }>;
}

export interface CompileApmResult {
  resolved: ResolvedCompileTargets;
  generated: CompiledHarnessFiles[];
  writtenFiles: string[];
  dryRun: boolean;
  warnings: string[];
  unicodeFindings: UnicodeScanFinding[];
}

function overlayToResources(overlay: ApmOverlayInfo): Resource[] {
  return overlay.primitives.map((primitive, index) => ({
    id: `apm-compile-${index}`,
    type: primitive.type,
    name: primitive.name,
    description: primitive.description,
    content: primitive.content,
    metadata: primitive.metadata,
    source: primitive.sourceRelative,
    namespace: "apm",
    origin_kind: "local_snapshot",
    origin_ref: primitive.sourceRelative,
    content_hash: "",
    content_blob_ref: "",
    created_at: "",
    updated_at: "",
  }));
}

export function resolveProjectCompileTargets(
  input: Omit<ResolveCompileTargetsInput, "manifestHarnessTargets">,
): ResolvedCompileTargets {
  const manifest = findProjectConfig(input.projectRoot);
  return resolveCompileTargets({
    ...input,
    ...(manifest && manifest.harnessTargets.length > 0
      ? { manifestHarnessTargets: manifest.harnessTargets }
      : {}),
  });
}

export async function compileApmProject(options: CompileApmOptions): Promise<CompileApmResult> {
  const manifest = findProjectConfig(options.projectRoot);
  if (!manifest) {
    throw new CompileError("No apm.yml found. Run ht config init or add an APM manifest at the project root.");
  }

  const resolved = resolveCompileTargets({
    projectRoot: options.projectRoot,
    mode: "compile",
    ...(options.cliTarget ? { cliTarget: options.cliTarget } : {}),
    ...(options.cliAll ? { cliAll: true } : {}),
    ...(options.cliHarness ? { cliHarness: options.cliHarness } : {}),
    ...(manifest.harnessTargets.length > 0
      ? { manifestHarnessTargets: manifest.harnessTargets }
      : {}),
  });

  const warnings = [
    ...manifest.warnings,
    ...resolved.warnings,
  ];

  if (resolved.harnessTargets.length === 0) {
    if (!warnings.includes(COMPILE_NO_TARGET_HINT)) {
      warnings.push(COMPILE_NO_TARGET_HINT);
    }
    return {
      resolved,
      generated: [],
      writtenFiles: [],
      dryRun: Boolean(options.dryRun),
      warnings,
      unicodeFindings: [],
    };
  }

  const overlay: ApmOverlayInfo | undefined =
    manifest.overlay ??
    inspectApmOverlay(options.projectRoot, {
      exclude: manifest.compilation?.exclude ?? [],
    });
  const resources = overlay ? overlayToResources(overlay) : [];
  if (resources.length === 0) {
    warnings.push("No local .apm/ (or root) primitives to compile");
  }

  const generated = await generateFiles(resources, resolved.harnessTargets, options.projectRoot, {
    skillSourceRoot: options.projectRoot,
  });
  const generatedFiles = generated.flatMap((result) =>
    result.files.map((file) => ({ path: file.path, content: file.content })),
  );
  const gate = gateDeployFiles(generatedFiles, { forceUnicode: options.force });

  if (options.dryRun) {
    return {
      resolved,
      generated: generated.map((result) => ({
        platformId: result.platformId,
        files: result.files.map((file) => ({ path: file.path, content: file.content })),
      })),
      writtenFiles: [],
      dryRun: true,
      warnings,
      unicodeFindings: gate.findings,
    };
  }

  const writtenFiles: string[] = [];
  for (const result of generated) {
    const materialized = await materializeFiles(result.files, options.projectRoot, {
      conflictPolicy: "replace",
    });
    writtenFiles.push(...materialized.writtenFiles);
  }

  return {
    resolved,
    generated: generated.map((result) => ({
      platformId: result.platformId,
      files: result.files.map((file) => ({ path: file.path, content: file.content })),
    })),
    writtenFiles,
    dryRun: false,
    warnings,
    unicodeFindings: gate.findings,
  };
}
