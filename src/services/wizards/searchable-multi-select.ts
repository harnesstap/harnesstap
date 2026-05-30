import {
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  makeTheme,
  useKeypress,
  usePagination,
  usePrefix,
  useState,
} from "@inquirer/core";

type SearchableChoice<T extends string> = {
  name: string;
  value: T;
  short?: string;
  description?: string;
};

type NormalizedChoice<T extends string> = SearchableChoice<T> & {
  checked: boolean;
};

type PromptConfig<T extends string> = {
  message: string;
  choices: SearchableChoice<T>[];
  default?: T[];
  pageSize?: number;
  loop?: boolean;
};

const searchableMultiSelectTheme = {
  icon: {
    checked: "[x]",
    unchecked: "[ ]",
    cursor: ">",
  },
  helpMode: "always",
  style: {
    renderSelectedChoices: <T extends string>(
      selectedChoices: Array<NormalizedChoice<T>>,
    ) => selectedChoices.map((choice) => choice.short ?? choice.name).join(", "),
    keysHelpTip: (keys: Array<[string, string]>) =>
      keys.map(([key, action]) => `${key} ${action}`).join(" • "),
  },
};

function normalizeChoices<T extends string>(
  choices: SearchableChoice<T>[],
  selectedValues: Set<T>,
): NormalizedChoice<T>[] {
  return choices.map((choice) => ({
    ...choice,
    checked: selectedValues.has(choice.value),
  }));
}

function matchesQuery<T extends string>(
  choice: SearchableChoice<T>,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }

  return `${choice.name} ${choice.value}`
    .toLowerCase()
    .includes(normalizedQuery);
}

function isSearchCharacter(key: {
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
}): key is { sequence: string } {
  return Boolean(
    key.sequence
      && key.sequence.length === 1
      && key.sequence.trim().length > 0
      && !key.ctrl
      && !key.meta,
  );
}

export const promptForSearchableMultiSelect = createPrompt<
  string[],
  PromptConfig<string>
>((config, done) => {
  const theme = makeTheme(searchableMultiSelectTheme, {});
  const prefix = usePrefix({ status: "idle", theme });
  const [items, setItems] = useState(() =>
    normalizeChoices(config.choices, new Set(config.default ?? [])),
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const visibleEntries = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => matchesQuery(item, query));
  const clampedActive =
    visibleEntries.length === 0
      ? 0
      : Math.min(active, visibleEntries.length - 1);

  useKeypress((key) => {
    if (isEnterKey(key)) {
      done(
        items.filter((item) => item.checked).map((item) => item.value),
      );
      return;
    }

    if (visibleEntries.length > 0 && (isUpKey(key) || isDownKey(key))) {
      const direction = isUpKey(key) ? -1 : 1;
      const next =
        config.loop === false
          ? Math.max(
              0,
              Math.min(clampedActive + direction, visibleEntries.length - 1),
            )
          : (clampedActive + direction + visibleEntries.length)
            % visibleEntries.length;
      setActive(next);
      return;
    }

    if (visibleEntries.length > 0 && isSpaceKey(key)) {
      const nextIndex = visibleEntries[clampedActive]?.index;
      if (nextIndex === undefined) {
        return;
      }

      setItems(
        items.map((item, index) =>
          index === nextIndex ? { ...item, checked: !item.checked } : item,
        ),
      );
      return;
    }

    if (key.ctrl && key.name === "a") {
      const visibleIndexes = new Set(visibleEntries.map(({ index }) => index));
      setItems(
        items.map((item, index) =>
          visibleIndexes.has(index) ? { ...item, checked: true } : item,
        ),
      );
      return;
    }

    if (key.ctrl && key.name === "x") {
      const visibleIndexes = new Set(visibleEntries.map(({ index }) => index));
      setItems(
        items.map((item, index) =>
          visibleIndexes.has(index) ? { ...item, checked: false } : item,
        ),
      );
      return;
    }

    if (isBackspaceKey(key)) {
      setQuery(query.slice(0, -1));
      setActive(0);
      return;
    }

    if (isSearchCharacter(key)) {
      setQuery(query + key.sequence);
      setActive(0);
    }
  });

  const page =
    visibleEntries.length === 0
      ? "  No matches"
      : usePagination({
          items: visibleEntries,
          active: clampedActive,
          renderItem({ item, isActive }) {
            const checkbox = item.item.checked
              ? theme.icon.checked
              : theme.icon.unchecked;
            const cursor = isActive ? theme.icon.cursor : " ";
            return `${cursor}${checkbox} ${item.item.name}`;
          },
          pageSize: config.pageSize ?? 10,
          loop: config.loop ?? false,
        });

  const helpLine = theme.style.keysHelpTip([
    ["↑↓", "navigate"],
    ["space", "toggle"],
    ["type", "search"],
    ["⌫", "erase"],
    ["ctrl+a", "all"],
    ["ctrl+x", "none"],
    ["⏎", "submit"],
  ]);

  return [
    `${prefix} ${theme.style.message(config.message, "idle")}`,
    `Search: ${query || "(type to filter)"}`,
    page,
    helpLine,
  ].join("\n");
});
