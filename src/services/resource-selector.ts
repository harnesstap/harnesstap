import type { ResourceType } from "../types.ts";

export interface ParsedResourceSelector {
  type?: ResourceType;
  name: string;
  namespace: string;
}

export function parseResourceSelector(selector: string): ParsedResourceSelector {
  let type: ResourceType | undefined;
  let namePart = selector;

  const colonIndex = selector.indexOf(":");
  if (colonIndex !== -1) {
    type = selector.slice(0, colonIndex) as ResourceType;
    namePart = selector.slice(colonIndex + 1);
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
