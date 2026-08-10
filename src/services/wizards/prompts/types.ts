import type { CatalogPlugin } from "../../catalog-types.js";

export type RemoteCatalogListMode =
  | { kind: "install" }
  | { kind: "apply" };

export type RemoteCatalogListConfig = {
  message: string;
  scopeLabel: string;
  mode: RemoteCatalogListMode;
  initialQuery?: string;
  listPlugins: (input: { q: string; limit: number }) => Promise<CatalogPlugin[]>;
};

export type RemoteCatalogListPromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export type RemoteCatalogListSelection = {
  orgSlug: string;
  catalogSlug: string;
  slug: string;
  version: string | null;
  selector: string;
};

export type RemoteCatalogListInstallResult = RemoteCatalogListSelection;

export type RemoteCatalogListApplyResult = {
  selections: RemoteCatalogListSelection[];
};

export type RemoteCatalogListResult =
  | RemoteCatalogListInstallResult
  | RemoteCatalogListApplyResult;
