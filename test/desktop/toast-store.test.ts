import { describe, expect, it } from "bun:test";
import {
  createToastStore,
  MAX_VISIBLE_TOASTS,
  TOAST_AUTO_DISMISS_MS,
  toastAutoDismissMs,
} from "../../apps/desktop/src/state/toast-store.ts";

interface Scheduled {
  fn: () => void;
  ms: number;
  cancelled: boolean;
}

function manualScheduler() {
  const scheduled: Scheduled[] = [];
  const schedule = (fn: () => void, ms: number) => {
    const entry: Scheduled = { fn, ms, cancelled: false };
    scheduled.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  const fire = (index: number) => {
    const entry = scheduled[index];
    if (entry && !entry.cancelled) {
      entry.fn();
    }
  };
  return { schedule, scheduled, fire };
}

const titles = (store: ReturnType<typeof createToastStore>) =>
  store.getState().map((toast) => toast.title);

describe("toast queue", () => {
  it("caps visible toasts at three and shows queued toasts as others dismiss", () => {
    const { schedule } = manualScheduler();
    const store = createToastStore(schedule);
    const ids = ["a", "b", "c", "d", "e"].map((title) =>
      store.toast({ tone: "success", title }),
    );
    expect(store.getState()).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(titles(store)).toEqual(["a", "b", "c"]);

    store.dismiss(ids[0]!);
    expect(titles(store)).toEqual(["b", "c", "d"]);

    store.dismiss(ids[3]!);
    expect(titles(store)).toEqual(["b", "c", "e"]);
  });

  it("auto-dismisses success toasts after 4s and keeps errors until closed", () => {
    const { schedule, scheduled, fire } = manualScheduler();
    const store = createToastStore(schedule);
    store.toast({ tone: "success", title: "Saved" });
    const errorId = store.toast({ tone: "error", title: "Failed" });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.ms).toBe(TOAST_AUTO_DISMISS_MS);
    fire(0);
    expect(titles(store)).toEqual(["Failed"]);

    store.dismiss(errorId);
    expect(store.getState()).toEqual([]);
  });

  it("does not start an auto-dismiss timer for a queued toast until it is shown", () => {
    const { schedule, scheduled } = manualScheduler();
    const store = createToastStore(schedule);
    for (const title of ["a", "b", "c"]) {
      store.toast({ tone: "error", title });
    }
    store.toast({ tone: "info", title: "queued" });
    expect(scheduled).toHaveLength(0);

    store.dismiss(store.getState()[0]!.id);
    expect(titles(store)).toEqual(["b", "c", "queued"]);
    expect(scheduled).toHaveLength(1);
  });

  it("dismissing a queued toast drops it without affecting visible ones", () => {
    const store = createToastStore(manualScheduler().schedule);
    for (const title of ["a", "b", "c"]) {
      store.toast({ tone: "error", title });
    }
    const queuedId = store.toast({ tone: "error", title: "queued" });
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.dismiss(queuedId);
    expect(notified).toBe(0);
    store.dismiss(store.getState()[0]!.id);
    expect(titles(store)).toEqual(["b", "c"]);
  });

  it("only errors are sticky", () => {
    expect(toastAutoDismissMs("error")).toBeNull();
    expect(toastAutoDismissMs("success")).toBe(TOAST_AUTO_DISMISS_MS);
    expect(toastAutoDismissMs("info")).toBe(TOAST_AUTO_DISMISS_MS);
  });
});
