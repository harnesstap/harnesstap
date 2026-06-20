import { isEscapeKey } from "../primitives.js";

export type BrowseShowView = "browse" | "show";

export type BrowseShowState<T> = {
  view: BrowseShowView;
  showingItem: T | null;
};

export function createBrowseShowState<T>(): BrowseShowState<T> {
  return { view: "browse", showingItem: null };
}

export function enterShowView<T>(item: T): Pick<BrowseShowState<T>, "view" | "showingItem"> {
  return { view: "show", showingItem: item };
}

export function exitShowView<T>(): Pick<BrowseShowState<T>, "view" | "showingItem"> {
  return { view: "browse", showingItem: null };
}

export function isInShowView(view: BrowseShowView): boolean {
  return view === "show";
}

export type ShowViewEscapeParams<T> = {
  view: BrowseShowView;
  setView: (view: BrowseShowView) => void;
  setShowingItem: (item: T | null) => void;
  key: { name?: string; sequence?: string };
};

export function handleShowViewEscape<T>(params: ShowViewEscapeParams<T>): boolean {
  if (!isInShowView(params.view)) {
    return false;
  }

  if (isEscapeKey(params.key)) {
    params.setView("browse");
    params.setShowingItem(null);
    return true;
  }

  return true;
}

export type EnterToShowParams<T> = {
  item: T | undefined | null;
  setView: (view: BrowseShowView) => void;
  setShowingItem: (item: T | null) => void;
};

export function handleEnterToShow<T>(params: EnterToShowParams<T>): boolean {
  if (!params.item) {
    return false;
  }

  params.setView("show");
  params.setShowingItem(params.item);
  return true;
}
