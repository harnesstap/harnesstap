import {
  createPrompt,
  isEnterKey,
  makeTheme,
  useEffect,
  useKeypress,
  usePrefix,
  useState,
} from "@inquirer/core";
import { createPromptScreen } from "../../../ui/prompt-screen.js";
import {
  handleEnterToShow,
  handleShowViewEscape,
  type BrowseShowView,
} from "./hooks/use-browse-show-view.js";
import { handleNavigationKeypress } from "./hooks/use-list-navigation.js";
import { handleSearchKeypress } from "./hooks/use-local-query-filter.js";
import { useTerminalSize } from "./hooks/use-terminal-size.js";
import {
  clampActiveIndex,
  interactivePromptTheme,
  isEscapeKey,
} from "./primitives.js";

export type FilterListPromptResult = {
  query: string;
};

export type FilterListPromptConfig<T> = {
  message: string;
  initialQuery?: string;
  resolveItems: (query: string) => {
    filtered: T[];
    navigable: T[];
  };
  renderBrowse: (args: {
    prefix: string;
    styledMessage: string;
    query: string;
    selectedItem: T | undefined;
    filtered: T[];
    navigable: T[];
    terminalWidth: number;
  }) => string;
  renderShow: (item: T) => string;
};

const filterListPromptBase = createPrompt<
  FilterListPromptResult,
  FilterListPromptConfig<unknown>
>((config, done) => {
  const promptTheme = makeTheme(interactivePromptTheme, {});
  const prefix = usePrefix({ status: "idle", theme: promptTheme });
  const [query, setQuery] = useState(config.initialQuery ?? "");
  const [active, setActive] = useState(0);
  const [view, setView] = useState<BrowseShowView>("browse");
  const [showingItem, setShowingItem] = useState<unknown | null>(null);
  const terminalWidth = useTerminalSize();

  useEffect(() => {
    const screen = createPromptScreen();
    screen.enter();
    return () => screen.exit();
  }, []);

  const { filtered, navigable } = config.resolveItems(query);
  const clampedActive = clampActiveIndex(active, navigable.length);
  const selectedItem = navigable[clampedActive] as unknown | undefined;
  const styledMessage = promptTheme.style.message(config.message, "idle");

  useKeypress((key) => {
    if (
      handleShowViewEscape({
        view,
        setView,
        setShowingItem,
        key,
      })
    ) {
      return;
    }

    if (isEscapeKey(key)) {
      done({ query: query.trim() });
      return;
    }

    if (isEnterKey(key)) {
      handleEnterToShow({
        item: selectedItem,
        setView,
        setShowingItem,
      });
      return;
    }

    if (
      handleNavigationKeypress({
        clampedActive,
        length: navigable.length,
        setActive,
        key,
      })
    ) {
      return;
    }

    handleSearchKeypress({ query, setQuery, setActive, key });
  });

  if (view === "show" && showingItem) {
    return config.renderShow(showingItem);
  }

  return config.renderBrowse({
    prefix,
    styledMessage,
    query,
    selectedItem,
    filtered,
    navigable,
    terminalWidth,
  });
});

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export function createFilterListPrompt<T>(
  config: FilterListPromptConfig<T>,
  context?: PromptContext,
): Promise<FilterListPromptResult> & { cancel: () => void } {
  return filterListPromptBase(config as FilterListPromptConfig<unknown>, context);
}
