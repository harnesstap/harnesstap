import type { DependencySourceKind } from "../types.js";

export interface ParsedDependencyRef {
  name: string;
  source_kind: DependencySourceKind;
  origin_ref: string;
  namespace: string;
}

const GIT_PREFIXES = ["http://", "https://", "file://", "git://", "git@", "ssh://", "git+"];

export function parseDependencyRef(ref: string): ParsedDependencyRef {
  const trimmed = ref.trim();

  if (GIT_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    const tail = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
    const name = tail.replace(/\.git$/, "").split(":").pop() ?? tail;
    return { name, source_kind: "git", origin_ref: trimmed, namespace: "" };
  }

  if (trimmed.startsWith("./") || trimmed.startsWith("../")) {
    const name = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
    return { name, source_kind: "local", origin_ref: trimmed, namespace: "" };
  }

  const slashParts = trimmed.split("/");
  if (slashParts.length === 3) {
    const [org, catalog, name] = slashParts;
    if (org && catalog && name) {
      return {
        name,
        source_kind: "catalog",
        origin_ref: trimmed,
        namespace: `${org}/${catalog}`,
      };
    }
  }

  const at = trimmed.lastIndexOf("@");
  if (at > 0) {
    const name = trimmed.slice(0, at);
    const namespace = trimmed.slice(at + 1);
    return { name, source_kind: "marketplace", origin_ref: trimmed, namespace };
  }

  return { name: trimmed, source_kind: "local", origin_ref: trimmed, namespace: "" };
}
