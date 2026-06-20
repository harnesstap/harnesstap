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
import {
  buildHelpLine,
  interactivePromptTheme,
  isEscapeKey,
  isSearchCharacter,
} from "./prompts/primitives.js";
import { PromptBackError } from "./shared.js";

const PROMPT_BACK_SENTINEL = "__harnessdeck_prompt_back__";

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
  initialQuery?: string;
  pageSize?: number;
  loop?: boolean;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

const searchableMultiSelectTheme = {
  ...interactivePromptTheme,
  icon: { checked: "[x]", unchecked: "[ ]", cursor: ">" },
  style: {
    ...interactivePromptTheme.style,
    renderSelectedChoices: <T extends string>(
      selectedChoices: Array<NormalizedChoice<T>>,
    ) => selectedChoices.map((choice) => choice.short ?? choice.name).join(", "),
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

  return `${choice.name} ${choice.value} ${choice.description ?? ""}`
    .toLowerCase()
    .includes(normalizedQuery);
}

const searchableMultiSelectPrompt = createPrompt<string[], PromptConfig<string>>(
  (config, done) => {
  const theme = makeTheme(searchableMultiSelectTheme, {});
  const prefix = usePrefix({ status: "idle", theme });
  const [items, setItems] = useState(() =>
    normalizeChoices(config.choices, new Set(config.default ?? [])),
  );
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const [active, setActive] = useState(0);

  const visibleEntries = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => matchesQuery(item, query));
  const clampedActive =
    visibleEntries.length === 0
      ? 0
      : Math.min(active, visibleEntries.length - 1);

  useKeypress((key) => {
    if (isEscapeKey(key)) {
      done([PROMPT_BACK_SENTINEL]);
      return;
    }

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
    },
  );

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

export async function promptForSearchableMultiSelect(
  config: PromptConfig<string>,
  context?: PromptContext,
): Promise<string[]> {
  const result = await searchableMultiSelectPrompt(config, context);
  if (result.length === 1 && result[0] === PROMPT_BACK_SENTINEL) {
    throw new PromptBackError();
  }
  return result;
}
