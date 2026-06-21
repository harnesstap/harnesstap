import {
  createPrompt,
  isEnterKey,
  isSpaceKey,
  makeTheme,
  useKeypress,
  usePagination,
  usePrefix,
  useState,
} from "@inquirer/core";
import {
  buildHelpLine,
  clampActiveIndex,
  interactivePromptTheme,
  isEscapeKey,
} from "./primitives.js";
import {
  setCheckedForIndexes,
  toggleCheckedAtIndex,
} from "./hooks/use-checkbox-selection.js";
import { handleNavigationKeypress } from "./hooks/use-list-navigation.js";
import { handleSearchKeypress } from "./hooks/use-local-query-filter.js";

export type LocalMultiSelectChoice<T extends string> = {
  name: string;
  value: T;
  short?: string;
  description?: string;
};

type NormalizedChoice<T extends string> = LocalMultiSelectChoice<T> & {
  checked: boolean;
};

export type LocalMultiSelectConfig<T extends string> = {
  message: string;
  choices: LocalMultiSelectChoice<T>[];
  default?: T[];
  initialQuery?: string;
  pageSize?: number;
  loop?: boolean;
  escapeSentinel: string;
};

function normalizeChoices<T extends string>(
  choices: LocalMultiSelectChoice<T>[],
  selectedValues: Set<T>,
): NormalizedChoice<T>[] {
  return choices.map((choice) => ({
    ...choice,
    checked: selectedValues.has(choice.value),
  }));
}

function matchesQuery<T extends string>(
  choice: LocalMultiSelectChoice<T>,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }

  return `${choice.name} ${choice.value} ${choice.description ?? ""}`
    .toLowerCase()
    .includes(normalizedQuery);
}

const localMultiSelectTheme = {
  ...interactivePromptTheme,
  icon: { checked: "[x]", unchecked: "[ ]", cursor: ">" },
  style: {
    ...interactivePromptTheme.style,
    renderSelectedChoices: <T extends string>(
      selectedChoices: Array<NormalizedChoice<T>>,
    ) => selectedChoices.map((choice) => choice.short ?? choice.name).join(", "),
  },
};

const localMultiSelectPromptBase = createPrompt<
  string[],
  LocalMultiSelectConfig<string>
>((config, done) => {
  const theme = makeTheme(localMultiSelectTheme, {});
  const prefix = usePrefix({ status: "idle", theme });
  const [items, setItems] = useState(() =>
    normalizeChoices(config.choices, new Set(config.default ?? [])),
  );
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const [active, setActive] = useState(0);

  const visibleEntries = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => matchesQuery(item, query));
  const clampedActive = clampActiveIndex(active, visibleEntries.length);

  useKeypress((key) => {
    if (isEscapeKey(key)) {
      done([config.escapeSentinel]);
      return;
    }

    if (isEnterKey(key)) {
      done(items.filter((item) => item.checked).map((item) => item.value));
      return;
    }

    if (
      handleNavigationKeypress({
        clampedActive,
        length: visibleEntries.length,
        setActive,
        key,
        loop: config.loop !== false,
      })
    ) {
      return;
    }

    if (visibleEntries.length > 0 && isSpaceKey(key)) {
      const nextIndex = visibleEntries[clampedActive]?.index;
      if (nextIndex === undefined) {
        return;
      }

      setItems(toggleCheckedAtIndex(items, nextIndex));
      return;
    }

    if (key.ctrl && key.name === "a") {
      const visibleIndexes = new Set(visibleEntries.map(({ index }) => index));
      setItems(setCheckedForIndexes(items, visibleIndexes, true));
      return;
    }

    if (key.ctrl && key.name === "x") {
      const visibleIndexes = new Set(visibleEntries.map(({ index }) => index));
      setItems(setCheckedForIndexes(items, visibleIndexes, false));
      return;
    }

    handleSearchKeypress({ query, setQuery, setActive, key });
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

  const helpLine = buildHelpLine([
    ["↑↓", "navigate"],
    ["space", "toggle"],
    ["type", "search"],
    ["⌫", "erase"],
    ["ctrl+a", "all"],
    ["ctrl+x", "none"],
    ["esc", "back"],
    ["⏎", "submit"],
  ]);

  return [
    `${prefix} ${theme.style.message(config.message, "idle")}`,
    `Search: ${query || "(type to filter)"}`,
    page,
    helpLine,
  ].join("\n");
});

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export function createLocalMultiSelectPrompt<T extends string>(
  config: LocalMultiSelectConfig<T>,
  context?: PromptContext,
): Promise<string[]> & { cancel: () => void } {
  return localMultiSelectPromptBase(
    config as LocalMultiSelectConfig<string>,
    context,
  ) as Promise<string[]> & { cancel: () => void };
}
