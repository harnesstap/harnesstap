import { Unlink } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  formatLibraryUpstream,
  inheritedItemKey,
  type InheritedItem,
  type LibraryPluginUpstream,
} from "../lib/api/library-plugins";
import { inheritedItemLabel } from "../lib/duplicate-profile";

export interface InheritedItemsSectionProps {
  upstream: LibraryPluginUpstream;
  items: InheritedItem[];
  parentMissing?: string;
  disabled: boolean;
  onToggle: (item: InheritedItem) => void;
  onDetach: () => void;
}

/** Items a kept-in-sync profile gets from its parent. Untick hides, tick shows again. */
export function InheritedItemsSection({
  upstream,
  items,
  parentMissing,
  disabled,
  onToggle,
  onDetach,
}: InheritedItemsSectionProps) {
  return (
    <section className="edit-profile-section" aria-label="From parent" data-testid="edit-profile-inherited">
      <div className="flex items-center justify-between gap-3">
        <p className="muted m-0 min-w-0 flex-1">
          Kept in sync with {formatLibraryUpstream(upstream)}. Untick an item to hide it here.
        </p>
        <button type="button" className="btn" style={{ width: "auto", flexShrink: 0 }} disabled={disabled} onClick={onDetach}>
          <Unlink size={16} aria-hidden />
          Detach from parent
        </button>
      </div>
      {parentMissing ? <div className="banner">{parentMissing}</div> : null}
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => {
          const key = inheritedItemKey(item);
          const id = `inherited-${key}`;
          return (
            <li key={key} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={!item.hidden}
                disabled={disabled}
                onCheckedChange={() => onToggle(item)}
                aria-label={item.hidden ? `Show ${item.name}` : `Hide ${item.name}`}
              />
              <label htmlFor={id} className={item.hidden ? "muted line-through" : undefined}>
                {inheritedItemLabel(item)}
              </label>
              <span className="chip">from parent</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
