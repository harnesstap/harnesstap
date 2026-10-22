import { createHash } from "node:crypto";
import type {
  MaterializationAction,
  MaterializationScope,
  Resource,
  SerializedFile,
  SerializeOptions,
  SerializerTarget,
} from "../types.js";
import { getDb } from "../db/connection.js";
import { formatResourceSelector } from "../models/resource.js";
import {
  recordResourceMaterialization,
} from "../models/resource-materialization.js";
import { normalizeLineEndingsAndTrailingNewlines } from "./file-contents-drift.js";
import { isMergeableHostConfigPath } from "./merged-host-config.js";
import { getPlatformSerializer } from "./platform-serializers.js";
import { inStatusComputation } from "./status-computation.js";

function normalizeFileContent(content: string): string {
  return normalizeLineEndingsAndTrailingNewlines(content);
}

export function hashGeneratedContent(content: string): string {
  const hex = createHash("sha256")
    .update(normalizeFileContent(content), "utf8")
    .digest("hex");
  return `sha256:${hex}`;
}

function ownershipKey(resource: Pick<Resource, "type" | "name" | "namespace">): string {
  return formatResourceSelector(resource, { includeType: true });
}

function actionForPath(
  path: string,
  shared: boolean,
): MaterializationAction {
  if (shared || isMergeableHostConfigPath(path)) {
    return "edit-file";
  }
  return "delete-file";
}

interface HarnessOwnershipMemo {
  /** Paths each resource serialized to, keyed by options plus the resource. */
  pathsByResource: Map<string, readonly string[]>;
  /** Combined output paths no single resource produced, sorted. */
  uncovered: string;
}

const ownershipMemo = new Map<string, HarnessOwnershipMemo>();
let ownershipMemoHits = 0;

/** Count of resources whose paths came from the memo, for tests. */
export function readOwnershipMemoHits(): number {
  return ownershipMemoHits;
}

export function clearOwnershipMemo(): void {
  ownershipMemo.clear();
}

async function contributedPathsByResource(
  files: SerializedFile[],
  resources: Resource[],
  context: { platformId: string; rootPath: string; target: SerializerTarget },
  serializeOptions: SerializeOptions,
): Promise<Map<string, Set<string>>> {
  const serializer = getPlatformSerializer(context.platformId);
  const serializeOne = async (resource: Resource): Promise<string[]> =>
    (await serializer.serialize([resource], context.rootPath, serializeOptions)).map((file) => file.path);

  // Only status reads reuse paths. An apply always serializes every resource.
  const reuse = inStatusComputation();
  const harnessKey = `${context.platformId}\0${context.rootPath}\0${context.target}`;
  const previous = reuse ? ownershipMemo.get(harnessKey) : undefined;
  const { surfaceWarnings: _surfaceWarnings, ...options } = serializeOptions;
  const optionsKey = reuse ? JSON.stringify(options) : "";
  const outputPaths = new Set(files.map((file) => file.path));

  const resourceKeys: string[] = [];
  const pathsPerResource: string[][] = [];
  const reusedIndexes: number[] = [];
  for (const resource of resources) {
    const resourceKey = reuse ? `${optionsKey}\0${JSON.stringify(resource)}` : "";
    resourceKeys.push(resourceKey);
    const cached = previous?.pathsByResource.get(resourceKey);
    // A cached path missing from the combined output means the resource's
    // inputs on disk changed (a companion file removed): serialize again.
    if (cached && cached.every((path) => outputPaths.has(path))) {
      reusedIndexes.push(pathsPerResource.length);
      pathsPerResource.push([...cached]);
      continue;
    }
    pathsPerResource.push(await serializeOne(resource));
  }

  const uncoveredOf = (lists: string[][]): string => {
    const covered = new Set(lists.flat());
    return JSON.stringify([...outputPaths].filter((path) => !covered.has(path)).sort());
  };
  let uncovered = uncoveredOf(pathsPerResource);
  // A combined output path that no resource claims, and that was not
  // unclaimed last time, can belong to a reused resource whose inputs grew
  // (a companion file added). Serialize the reused ones again.
  if (reusedIndexes.length > 0 && previous && uncovered !== previous.uncovered) {
    for (const index of reusedIndexes) {
      const resource = resources[index];
      if (resource) pathsPerResource[index] = await serializeOne(resource);
    }
    uncovered = uncoveredOf(pathsPerResource);
  } else {
    ownershipMemoHits += reusedIndexes.length;
  }

  if (reuse) {
    const pathsByResource = new Map<string, readonly string[]>();
    resourceKeys.forEach((key, index) => {
      pathsByResource.set(key, pathsPerResource[index] ?? []);
    });
    ownershipMemo.set(harnessKey, { pathsByResource, uncovered });
  }

  const pathToResourceIds = new Map<string, Set<string>>();
  resources.forEach((resource, index) => {
    for (const path of pathsPerResource[index] ?? []) {
      const ids = pathToResourceIds.get(path) ?? new Set<string>();
      ids.add(resource.id);
      pathToResourceIds.set(path, ids);
    }
  });
  return pathToResourceIds;
}

export async function attachResourceOwnership(
  files: SerializedFile[],
  resources: Resource[],
  context: {
    platformId: string;
    rootPath: string;
    target: SerializerTarget;
    serializeOptions?: Omit<SerializeOptions, "target">;
  },
): Promise<SerializedFile[]> {
  if (resources.length === 0 || files.length === 0) {
    return files;
  }

  const serializeOptions: SerializeOptions = {
    target: context.target,
    ...context.serializeOptions,
  };
  const pathToResourceIds = await contributedPathsByResource(files, resources, context, serializeOptions);

  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));

  return files.map((file) => {
    const contributorIds = pathToResourceIds.get(file.path);
    if (!contributorIds || contributorIds.size === 0) {
      return file;
    }

    const shared = contributorIds.size > 1;
    const ownership = [...contributorIds].flatMap((resourceId) => {
      const resource = resourceById.get(resourceId);
      if (!resource) {
        return [];
      }
      const action = actionForPath(file.path, shared);
      return [{
        resource_id: resourceId,
        action,
        ownership_key: ownershipKey(resource),
        managed_container: action === "delete-directory",
      }];
    });

    return ownership.length > 0 ? { ...file, ownership } : file;
  });
}

export function persistWrittenMaterializations(input: {
  scope: MaterializationScope;
  project_id?: string | null;
  root_path: string;
  platformResults: Array<{
    platformId: string;
    files: SerializedFile[];
    writtenPaths: string[];
  }>;
}): void {
  const projectId = input.project_id ?? null;

  for (const result of input.platformResults) {
    // Only rows for bytes we actually wrote. Skipping a live file must not
    // rewrite generated_hash, or a later removal would treat user edits as owned.
    const writtenPaths = new Set(result.writtenPaths);
    const entries = result.files.flatMap((file) => {
      if (!writtenPaths.has(file.path) || !file.ownership?.length) {
        return [];
      }
      // Hash the bytes the way the on-disk check reads them, so a binary
      // (base64) file is not seen as changed right after it is written.
      const generatedHash = hashGeneratedContent(
        file.encoding === "base64" ? Buffer.from(file.content, "base64").toString("utf-8") : file.content,
      );
      return file.ownership.map((ownership) => ({
        resource_id: ownership.resource_id,
        path: file.path,
        action: ownership.action,
        ownership_key: ownership.ownership_key,
        generated_hash: generatedHash,
        managed_container: ownership.managed_container,
      }));
    });

    for (const entry of entries) {
      try {
        if (
          !getDb().prepare("SELECT 1 as ok FROM resources WHERE id = ? LIMIT 1").get(entry.resource_id)
        ) {
          continue;
        }
      } catch {
        continue;
      }
      recordResourceMaterialization({
        resource_id: entry.resource_id,
        scope: input.scope,
        project_id: projectId,
        root_path: input.root_path,
        platform_id: result.platformId,
        path: entry.path,
        action: entry.action,
        ownership_key: entry.ownership_key,
        generated_hash: entry.generated_hash,
        managed_container: entry.managed_container,
      });
    }
  }
}
