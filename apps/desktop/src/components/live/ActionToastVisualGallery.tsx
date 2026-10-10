import { APPLY_RESULT_COPY } from "../../lib/ui-copy";
import { ToastCard } from "../shell/ToastRegion";

/** Dedicated `?visual=action-toast` mount for G8 of an apply result with an action. */
export function ActionToastVisualGallery() {
  return (
    <main
      data-testid="action-toast-gallery"
      aria-label="Action toast visual gallery"
      style={{ minHeight: "100vh" }}
    >
      <div className="toast-region" role="region" aria-label="Notifications">
        <ToastCard
          item={{
            tone: "success",
            title: APPLY_RESULT_COPY.wroteRemovedKept(0, 6, 19),
            action: {
              label: APPLY_RESULT_COPY.viewSnapshot,
              onClick: () => {},
            },
          }}
        />
      </div>
    </main>
  );
}
