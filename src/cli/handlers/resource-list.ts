import type { ResourceType } from "../../types.js";
import { RESOURCE_TYPES } from "../../types.js";
import { ui } from "../../ui/index.js";
import type { Column } from "../../ui/table.js";
import { parseOutputFormat } from "../../utils/output-format.js";
import { shouldUseWizard } from "../../services/wizards/shared.js";

export function makeResourceTypeColumn(width = 14): Column {
  return {
    key: "type",
    header: "TYPE",
    width,
    style: (value) => ui.theme.resourceType(value),
  };
}

export function isLayerAttachmentOnlyType(type: string | undefined): boolean {
  if (!type) {
    return false;
  }
  return type === "plugin";
}

export function resolveResourceListType(
  positionalType?: string,
  flagType?: string,
): ResourceType | undefined | "invalid" | "conflict" {
  if (positionalType && flagType && positionalType !== flagType) {
    return "conflict";
  }
  const type = positionalType ?? flagType;
  if (!type) {
    return undefined;
  }
  if (!RESOURCE_TYPES.includes(type as ResourceType)) {
    return "invalid";
  }
  return type as ResourceType;
}

export function shouldUseInteractiveResourceList(input: {
  noInteractive?: boolean;
  format?: string;
  search?: string;
}): boolean {
  if (input.search) {
    return false;
  }

  return shouldUseWizard({
    interactive: true,
    noInteractive: input.noInteractive,
    format: parseOutputFormat(input.format),
    missingRequiredArgs: true,
  });
}

export function resourceListRenderOptions(opts: {
  showId?: boolean;
  all?: boolean;
}): { showId: boolean; showAll: boolean } {
  return {
    showId: Boolean(opts.showId),
    showAll: Boolean(opts.all),
  };
}
