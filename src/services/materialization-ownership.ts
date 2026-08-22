import { createHash } from "node:crypto";
import type {
  MaterializationAction,
  MaterializationScope,
  Resource,
  SerializedFile,
  SerializeOptions,
  SerializerTarget,
} from "../types.js";
import { formatResourceSelector } from "../models/resource.js";
import {
  replaceMaterializationsForPlatform,
} from "../models/resource-materialization.js";
import { getPlatformSerializer } from "./platform-serializers.js";

function normalizeFileContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\n+$/, "");
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
  resource: Resource,
  shared: boolean,
): MaterializationAction {
  if (shared) {
    return "edit-file";
  }
  if (resource.type === "skill" && path.endsWith("SKILL.md")) {
    return "delete-directory";
  }
  return "delete-file";
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

  const serializer = getPlatformSerializer(context.platformId);
  const serializeOptions: SerializeOptions = {
    target: context.target,
    ...context.serializeOptions,
  };
  const pathToResourceIds = new Map<string, Set<string>>();

  for (const resource of resources) {
    const singleFiles = await serializer.serialize(
      [resource],
      context.rootPath,
      serializeOptions,
    );
    for (const file of singleFiles) {
      const ids = pathToResourceIds.get(file.path) ?? new Set<string>();
      ids.add(resource.id);
      pathToResourceIds.set(file.path, ids);
    }
  }

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
      const action = actionForPath(file.path, resource, shared);
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
    const writtenPaths = new Set(result.writtenPaths);
    const entries = result.files.flatMap((file) => {
      if (!writtenPaths.has(file.path) || !file.ownership?.length) {
        return [];
      }
      const generatedHash = hashGeneratedContent(file.content);
      return file.ownership.map((ownership) => ({
        resource_id: ownership.resource_id,
        path: file.path,
        action: ownership.action,
        ownership_key: ownership.ownership_key,
        generated_hash: generatedHash,
        managed_container: ownership.managed_container,
      }));
    });

    replaceMaterializationsForPlatform({
      scope: input.scope,
      project_id: projectId,
      root_path: input.root_path,
      platform_id: result.platformId,
      entries,
    });
  }
}
