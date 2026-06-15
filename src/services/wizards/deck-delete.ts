import { listDeckNamesForWizard } from "../deck-commands.js";
import { promptForSearchableMultiSelect } from "./searchable-multi-select.js";
import { promptForValue } from "./shared.js";

function filterDecksBySearch<T extends { name: string; id: string; root_path: string }>(
  decks: T[],
  search?: string,
): T[] {
  const normalizedSearch = search?.trim().toLowerCase();
  if (!normalizedSearch) {
    return decks;
  }

  return decks.filter((deck) =>
    `${deck.name} ${deck.id} ${deck.root_path}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
}

export async function runDeckDeleteWizard(input?: {
  search?: string;
}): Promise<string[]> {
  const decks = filterDecksBySearch(listDeckNamesForWizard(), input?.search);
  if (decks.length > 0) {
    return promptForSearchableMultiSelect({
      message: "Which decks do you want to delete?",
      initialQuery: input?.search,
      choices: decks.map((deck) => ({
        name: deck.name,
        value: deck.name,
        description: deck.root_path || undefined,
      })),
      pageSize: 10,
      loop: false,
    });
  }

  const selector = await promptForValue({
    message: "Deck name or ID to delete",
    default: input?.search,
  });
  return selector.length > 0 ? [selector] : [];
}
