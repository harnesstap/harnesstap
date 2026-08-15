import type { ReactNode } from "react";

export type LibraryTab = "packages" | "items";

export interface LibraryWorkspaceProps {
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  disabled?: boolean;
  packages: ReactNode;
  items: ReactNode;
}

export function LibraryWorkspace({
  tab,
  onTabChange,
  disabled = false,
  packages,
  items,
}: LibraryWorkspaceProps) {
  return (
    <div className="library-workspace">
      <div className="library-tabs segment" role="tablist" aria-label="Library collections">
        <button
          type="button"
          role="tab"
          data-testid="library-tab-items"
          className={tab === "items" ? "on" : ""}
          aria-selected={tab === "items"}
          disabled={disabled}
          onClick={() => onTabChange("items")}
        >Items</button>
        <button
          type="button"
          role="tab"
          data-testid="library-tab-packages"
          className={tab === "packages" ? "on" : ""}
          aria-selected={tab === "packages"}
          disabled={disabled}
          onClick={() => onTabChange("packages")}
        >Packages</button>
      </div>
      {tab === "items" ? items : packages}
    </div>
  );
}
