import type { ResourceType } from "../types.ts";

export interface ParsedResourceSelector {
  type?: ResourceType;
  name: string;
  namespace: string;
}

const LEGACY_TYPE_ALIASES: Record<string, string> = {
  plugin_pin: "plugin",
};

let deprecations: string[] = [];

/** Drain and return deprecation notices recorded since the last call. */
export function takeSelectorDeprecations(): string[] {
  const collected = deprecations;
  deprecations = [];
  return collected;
}

export function parseResourceSelector(selector: string): ParsedResourceSelector {
  let type: ResourceType | undefined;
  let namePart = selector;

  const colonIndex = selector.indexOf(":");
  if (colonIndex !== -1) {
    const rawType = selector.slice(0, colonIndex);
    namePart = selector.slice(colonIndex + 1);
    const alias = LEGACY_TYPE_ALIASES[rawType];
    if (alias) {
      deprecations.push(`${rawType}: is now ${alias}: — use ${alias}:${namePart}`);
    }
    type = (alias ?? rawType) as ResourceType;
  }

  const atIndex = namePart.lastIndexOf("@");
  if (atIndex !== -1) {
    return {
      type,
      name: namePart.slice(0, atIndex),
      namespace: namePart.slice(atIndex + 1),
    };
  }

  return {
    type,
    name: namePart,
    namespace: "",
  };
}
