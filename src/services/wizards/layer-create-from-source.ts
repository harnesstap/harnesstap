import { getLayerByName } from "../../models/plugin-model.js";
import type { DiscoveredSkill } from "../skill-discovery.js";
import {
  DEFAULT_EXCLUDED_SKILL_CATEGORIES,
  type LayerSourceConflictPolicy,
  defaultInteractiveSkillNames,
} from "../skill-package-resolve.js";
import { promptForSearchableMultiSelect } from "./searchable-multi-select.js";
import { promptForChoice } from "./shared.js";

function buildSkillChoices(discovered: DiscoveredSkill[]) {
  const byCategory = new Map<string, DiscoveredSkill[]>();
  for (const skill of discovered) {
    const category = skill.category || "general";
    const group = byCategory.get(category) ?? [];
    group.push(skill);
    byCategory.set(category, group);
  }

  const categories = [...byCategory.keys()].sort((a, b) => a.localeCompare(b));
  const choices: Array<{ name: string; value: string; description?: string }> = [];
  for (const category of categories) {
    const skills = byCategory.get(category) ?? [];
    for (const skill of skills.sort((a, b) => a.name.localeCompare(b.name))) {
      const description = skill.description.trim() || undefined;
      choices.push({
        name: `[${category}] ${skill.name}`,
        value: skill.name,
        description,
      });
    }
  }
  return choices;
}

export interface LayerCreateFromSourceWizardResult {
  skillNames?: string[];
  all?: boolean;
  onConflict: LayerSourceConflictPolicy;
  cancelled: boolean;
}

export async function runLayerCreateFromSourceWizard(input: {
  layerName: string;
  layerVersion: string;
  discovered: DiscoveredSkill[];
  skillNames?: string[];
  all?: boolean;
  excludeCategories?: string[];
  onConflict?: LayerSourceConflictPolicy;
  shouldPrompt: boolean;
}): Promise<LayerCreateFromSourceWizardResult> {
  const excludeCategories =
    input.excludeCategories ?? [...DEFAULT_EXCLUDED_SKILL_CATEGORIES];

  let skillNames = input.skillNames;
  let all = input.all;

  if (!all && (!skillNames || skillNames.length === 0)) {
    if (!input.shouldPrompt) {
      throw new Error("No skills selected. Pass --skill <names>, --all, or use the wizard.");
    }

    const selected = await promptForSearchableMultiSelect({
      message: "Which skills should this layer include?",
      choices: buildSkillChoices(input.discovered),
      default: defaultInteractiveSkillNames(input.discovered, excludeCategories),
      pageSize: 12,
      loop: false,
    });
    if (selected.length === 0) {
      throw new Error("No skills selected.");
    }
    if (selected.length === input.discovered.length) {
      all = true;
      skillNames = undefined;
    } else {
      skillNames = selected;
    }
  }

  const existing = getLayerByName(input.layerName, input.layerVersion);
  if (!existing) {
    return {
      skillNames,
      all,
      onConflict: "cancel",
      cancelled: false,
    };
  }

  if (input.onConflict && input.onConflict !== "cancel") {
    return {
      skillNames,
      all,
      onConflict: input.onConflict,
      cancelled: false,
    };
  }

  if (!input.shouldPrompt) {
    return {
      skillNames,
      all,
      onConflict: "cancel",
      cancelled: false,
    };
  }

  const action = await promptForChoice({
    message: `Layer "${input.layerName}@${input.layerVersion}" already exists. How do you want to proceed?`,
    choices: [
      { name: "Merge new skills into existing layer", value: "merge" as const },
      { name: "Overwrite layer (replace attachments from this import)", value: "overwrite" as const },
      { name: "Cancel", value: "cancel" as const },
    ],
    default: "merge",
  });

  if (action === "cancel") {
    return {
      skillNames,
      all,
      onConflict: "cancel",
      cancelled: true,
    };
  }

  return {
    skillNames,
    all,
    onConflict: action,
    cancelled: false,
  };
}
