export type HelpAction = [string, string];

export type TableBrowserIntent =
  | { kind: "filter" }
  | { kind: "pick-one"; action?: "show" | "delete" }
  | { kind: "pick-many" }
  | { kind: "manage" }
  | { kind: "install" };

export type ViewportRenderArgs<T> = {
  query: string;
  filtered: T[];
  navigable: T[];
  active: number;
  selectedItem: T | undefined;
  terminalWidth: number;
  terminalRows: number;
};

export type TableBrowserAdapter<T, TResult> = {
  resolveItems: (query: string) => { filtered: T[]; navigable: T[] };
  renderViewport: (args: ViewportRenderArgs<T>) => string;
  renderShow?: (item: T) => string;
  onPick?: (item: T) => TResult;
  onDelete?: (item: T) => Promise<boolean>;
  helpActions: HelpAction[];
  formatDeleteConfirm?: (item: T) => string;
};

export type TableBrowserConfig<T, TResult> = {
  message: string;
  initialQuery?: string;
  intent: TableBrowserIntent;
  adapter: TableBrowserAdapter<T, TResult>;
};

export type TableBrowserResult<TResult> =
  | { kind: "filter"; query: string }
  | { kind: "pick-one"; value: TResult }
  | { kind: "pick-many"; values: TResult[] }
  | { kind: "cancel" };
