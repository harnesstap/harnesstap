import { isBackspaceKey } from "@inquirer/core";
import { isSearchCharacter, toInquirerKey, type InteractiveKeypress } from "../primitives.js";

export function appendToQuery(query: string, char: string): string {
  return query + char;
}

export function backspaceQuery(query: string): string {
  return query.slice(0, -1);
}

export function createQueryFilterState(initialQuery = "") {
  return {
    query: initialQuery,
    appendChar(query: string, char: string) {
      return { query: appendToQuery(query, char), activeReset: 0 as const };
    },
    backspace(query: string) {
      return { query: backspaceQuery(query), activeReset: 0 as const };
    },
  };
}

export type SearchKeypressParams = {
  query: string;
  setQuery: (query: string) => void;
  setActive: (active: number) => void;
  key: InteractiveKeypress;
  onQueryChange?: (nextQuery: string) => void;
};

export function handleSearchKeypress(params: SearchKeypressParams): boolean {
  const { query, setQuery, setActive, key, onQueryChange } = params;
  const inquirerKey = toInquirerKey(key);

  if (isBackspaceKey(inquirerKey)) {
    const nextQuery = backspaceQuery(query);
    setQuery(nextQuery);
    setActive(0);
    onQueryChange?.(nextQuery);
    return true;
  }

  if (isSearchCharacter(key)) {
    const nextQuery = appendToQuery(query, key.sequence);
    setQuery(nextQuery);
    setActive(0);
    onQueryChange?.(nextQuery);
    return true;
  }

  return false;
}
