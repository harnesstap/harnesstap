import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ListPlus, X } from "lucide-react";
import { ChromeTooltip } from "../ChromeTooltip";
import { IconActionButton } from "../IconActionButton";
import type { SectionSuggestion } from "../../lib/chip-harness";

const ICON_PX = 14;

export const SUGGESTION_COPY = {
  addAll: "Add all",
  addAllTooltip: (suggestion: SectionSuggestion) =>
    `Add ${suggestion.list} to the tools they are missing`,
  dismiss: "Dismiss",
  dismissTooltip: "Not now. Hide this suggestion",
  listTooltip: (suggestion: SectionSuggestion) => suggestion.list,
} as const;

/**
 * One Also use on line per type section: "3 MCPs could also run on Cursor
 * and Codex", with Add all and Dismiss. Hover lists the resources; clicking
 * the text expands the list in place.
 */
export function SectionSuggestionLine({
  suggestion,
  busy = false,
  onAddAll,
  onDismiss,
}: {
  suggestion: SectionSuggestion;
  busy?: boolean;
  onAddAll: () => void;
  onDismiss: () => void;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="section-suggestion" data-testid="section-suggestion" data-expanded={expanded}>
      <div className="section-suggestion-line">
        <ChromeTooltip content={SUGGESTION_COPY.listTooltip(suggestion)}>
          <button
            type="button"
            className="section-suggestion-toggle"
            aria-expanded={expanded}
            data-testid="section-suggestion-toggle"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <ChevronDown size={ICON_PX} strokeWidth={2} aria-hidden />
            ) : (
              <ChevronRight size={ICON_PX} strokeWidth={2} aria-hidden />
            )}
            <span>{suggestion.label}</span>
          </button>
        </ChromeTooltip>
        <span className="section-suggestion-actions">
          <IconActionButton
            showLabel
            busy={busy}
            spinnerSize={ICON_PX}
            label={SUGGESTION_COPY.addAll}
            title={SUGGESTION_COPY.addAllTooltip(suggestion)}
            data-testid="section-suggestion-add-all"
            onClick={onAddAll}
            icon={<ListPlus size={ICON_PX} strokeWidth={2} aria-hidden />}
          />
          <IconActionButton
            label={SUGGESTION_COPY.dismiss}
            title={SUGGESTION_COPY.dismissTooltip}
            data-testid="section-suggestion-dismiss"
            disabled={busy}
            onClick={onDismiss}
            icon={<X size={ICON_PX} strokeWidth={2} aria-hidden />}
          />
        </span>
      </div>
      {expanded ? (
        <ul className="section-suggestion-list" data-testid="section-suggestion-list">
          {suggestion.items.map((item) => (
            <li key={item.key}>{item.name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
