import type { PluginDoctorCheckResult, PluginDoctorContext } from "../plugin-doctor.types.js";
import {
  emptyDefinitionMessage,
  isResourceDefinitionEmpty,
} from "../../resource-definition.js";

export const emptyContentCheck = {
  id: "empty-content",
  description: "Detect resources whose definition is empty or incomplete",
  run({ resources }: PluginDoctorContext): PluginDoctorCheckResult[] {
    return resources
      .filter((resource) => isResourceDefinitionEmpty(resource))
      .map((resource) => ({
        severity: "warn" as const,
        message: emptyDefinitionMessage(resource.type, resource.name),
      }));
  },
};
