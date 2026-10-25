import { RefreshCw } from "lucide-react";
import { loadErrorCopy } from "../lib/ui-copy";
import { EmptyState } from "./EmptyState";

export interface LoadErrorStateProps {
  /** Plural noun, e.g. "environments". */
  noun: string;
  onRetry: () => void;
  retryDisabled?: boolean;
  testId?: string;
}

/** The single state a page shows when its list failed to load. */
export function LoadErrorState({ noun, onRetry, retryDisabled, testId }: LoadErrorStateProps) {
  const copy = loadErrorCopy(noun);
  return (
    <EmptyState
      className="load-error-state"
      testId={testId}
      title={copy.title}
      body={copy.body}
      action={{
        label: copy.action,
        onClick: onRetry,
        disabled: retryDisabled,
        icon: <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />,
      }}
    />
  );
}
