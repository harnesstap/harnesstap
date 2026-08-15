import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CatalogPlugin,
  LibraryResource,
  PluginMarketplaceEntry,
} from "../../lib/types";
import { ButtonSpinner } from "../ButtonSpinner";
import {
  ResourceSelectionList,
  SelectionList,
  type SelectionRow,
} from "../CompositionPickers";

export interface PluginCompositionFieldsProps {
  showMarketplace: boolean;
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  marketplaces: PluginMarketplaceEntry[];
  marketplaceName: string;
  onMarketplaceName: (value: string) => void;
  catalogPlugins: CatalogPlugin[];
  pluginsLoading: boolean;
  pluginRef: string;
  onPluginRef: (value: string) => void;
  onPin: () => void;
  pinDisabled: boolean;
  pinBusy?: boolean;
  marketplaceSelectId: string;
  pluginSelectId: string;
  pluginRefTestId?: string;
  pinTestId?: string;
  libraryLoading: boolean;
  libraryError: string | null;
  pluginRows: SelectionRow[];
  selectedPluginIds: string[];
  onTogglePlugin: (id: string) => void;
  resources: LibraryResource[];
  resourceFilter: string;
  onResourceFilter: (value: string) => void;
  selectedResourceIds: string[];
  onToggleResource: (id: string) => void;
  disabled: boolean;
}

export function PluginCompositionFields({
  showMarketplace,
  marketplaceLoading,
  marketplaceError,
  marketplaces,
  marketplaceName,
  onMarketplaceName,
  catalogPlugins,
  pluginsLoading,
  pluginRef,
  onPluginRef,
  onPin,
  pinDisabled,
  pinBusy,
  marketplaceSelectId,
  pluginSelectId,
  pluginRefTestId,
  pinTestId,
  libraryLoading,
  libraryError,
  pluginRows,
  selectedPluginIds,
  onTogglePlugin,
  resources,
  resourceFilter,
  onResourceFilter,
  selectedResourceIds,
  onToggleResource,
  disabled,
}: PluginCompositionFieldsProps) {
  return (
    <>
      {showMarketplace ? (
        <section className="edit-profile-section" aria-label="Marketplace plugins">
          <h3>Marketplace plugins</h3>
          {marketplaceLoading ? (
            <p className="muted">Loading marketplaces…</p>
          ) : marketplaceError ? (
            <div className="banner error">{marketplaceError}</div>
          ) : marketplaces.length === 0 ? (
            <p className="muted">
              No marketplaces registered. Add one in Settings.
            </p>
          ) : (
            <div className="edit-plugin-pin">
              {marketplaces.length > 1 ? (
                <div className="form-field gap-1.5">
                  <Label htmlFor={marketplaceSelectId}>Marketplace</Label>
                  <Select
                    value={marketplaceName}
                    onValueChange={onMarketplaceName}
                    disabled={disabled || pluginsLoading}
                  >
                    <SelectTrigger
                      id={marketplaceSelectId}
                      className="w-full"
                    >
                      <SelectValue placeholder="Select a marketplace…" />
                    </SelectTrigger>
                    <SelectContent>
                      {marketplaces.map((entry) => (
                        <SelectItem key={entry.name} value={entry.name}>
                          {entry.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="form-field gap-1.5">
                <Label htmlFor={pluginSelectId}>Plugin</Label>
                {pluginsLoading ? (
                  <p className="muted">Loading plugins…</p>
                ) : catalogPlugins.length === 0 ? (
                  <p className="muted">No plugins in this marketplace.</p>
                ) : (
                  <Select
                    value={pluginRef}
                    onValueChange={onPluginRef}
                    disabled={disabled}
                  >
                    <SelectTrigger
                      id={pluginSelectId}
                      className="w-full"
                      data-testid={pluginRefTestId}
                    >
                      <SelectValue placeholder="Select a plugin…" />
                    </SelectTrigger>
                    <SelectContent>
                      {catalogPlugins.map((plugin) => (
                        <SelectItem key={plugin.ref} value={plugin.ref}>
                          {plugin.name}
                          {plugin.version ? ` @ ${plugin.version}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <button
                type="button"
                className="btn primary"
                data-testid={pinTestId}
                onClick={onPin}
                disabled={pinDisabled}
              >
                {pinBusy ? <ButtonSpinner size={14} /> : null}
                Pin plugin
              </button>
            </div>
          )}
        </section>
      ) : null}

      <section className="edit-profile-section" aria-label="Composition">
        <h3>Composition</h3>
        <div className="compose-library">
          {libraryLoading ? (
            <p className="muted">Loading local library…</p>
          ) : libraryError ? (
            <div className="banner error">{libraryError}</div>
          ) : (
            <>
              <SelectionList
                title="Plugins"
                emptyLabel="No plugins available."
                rows={pluginRows}
                selectedIds={selectedPluginIds}
                disabled={disabled}
                onToggle={onTogglePlugin}
              />
              <ResourceSelectionList
                resources={resources}
                filter={resourceFilter}
                onFilterChange={onResourceFilter}
                selectedIds={selectedResourceIds}
                disabled={disabled}
                onToggle={onToggleResource}
              />
            </>
          )}
        </div>
      </section>
    </>
  );
}
