export type HelpAction = [string, string];

/** Filter-intent wrapper return shape (legacy alias). */
export type FilterListPromptResult = { query: string };

export type TableBrowserIntent =
  | { kind: "filter" }
  | { kind: "pick-one"; action?: "show" | "delete" }
  | { kind: "pick-many" }
  | { kind: "manage" }
  | { kind: "install" };

export type ManageAction =
  | { type: "quit" }
  | { type: "cancel" }
  | { type: "edit"; rowIndex: number }
  | { type: "add" }
  | { type: "delete"; rowIndex: number };

export type ViewportRenderArgs<T> = {
  query: string;
  filtered: T[];
  navigable: T[];
  active: number;
  selectedItem: T | undefined;
  terminalWidth: number;
  terminalRows: number;
  prefix: string;
  styledMessage: string;
  items?: T[];
  checkedCount?: number;
};

export type ConstraintRenderArgs<T> = {
  prefix: string;
  styledMessage: string;
  target: T | undefined;
  constraintDraft: string;
  helpLine: string;
};

export type TableBrowserAdapter<T, TResult> = {
  resolveItems: (query: string) => { filtered: T[]; navigable: T[] };
  renderViewport: (args: ViewportRenderArgs<T>) => string;
  renderShow?: (item: T) => string;
  onPick?: (item: T) => TResult;
  onDelete?: (item: T) => Promise<boolean>;
  helpActions: HelpAction[];
  formatDeleteConfirm?: (item: T) => string;
  getItemKey?: (item: T) => string;
};

export type TableBrowserConfig<T, TResult> = {
  message: string;
  initialQuery?: string;
  intent: TableBrowserIntent;
  adapter: TableBrowserAdapter<T, TResult>;
  pickManyItems?: T[];
  resolvePickManyItems?: (items: T[], query: string) => { filtered: T[]; navigable: T[] };
  onCommitPickMany?: (items: T[]) => TResult[];
  requiresVersionConstraint?: (item: T) => boolean;
  renderConstraint?: (args: ConstraintRenderArgs<T>) => string;
  cancelMessage?: string;
  manageSourceRows?: T[];
};

export type TableBrowserResult<TResult> =
  | { kind: "filter"; query: string }
  | { kind: "pick-one"; value: TResult }
  | { kind: "pick-many"; values: TResult[] }
  | { kind: "manage"; action: ManageAction }
  | { kind: "install"; value: TResult }
  | { kind: "cancel" };
