import { getSteamStoreGameContext } from "../routing/store-page";
import { ShareService } from "../services/share-service";
import { FriendPicker } from "../ui/friend-picker";
import { NativeShareButton } from "../ui/native-share-button";
import { ToastPresenter } from "../ui/toast";

/** Keeps the injected UI in sync with Steam's client-side page updates. */
export class SteamShareController {
  private observer: MutationObserver | undefined;
  private injectionQueued = false;
  private restoreHistory: (() => void) | undefined;

  public constructor(
    private readonly shareService: ShareService,
    private readonly friendPicker: FriendPicker,
    private readonly button: NativeShareButton,
    private readonly toaster: ToastPresenter,
  ) {}

  public start(): void {
    this.observePageChanges();
    this.scheduleReconcile();
  }

  public stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.restoreHistory?.();
    this.restoreHistory = undefined;
    this.button.remove();
  }

  private observePageChanges(): void {
    const schedule = (): void => this.scheduleReconcile();
    window.addEventListener("popstate", schedule);
    window.addEventListener("hashchange", schedule);
    this.restoreHistory = this.patchHistory(schedule, () => {
      window.removeEventListener("popstate", schedule);
      window.removeEventListener("hashchange", schedule);
    });

    this.observer = new MutationObserver(schedule);
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  private patchHistory(schedule: () => void, restoreListeners: () => void): () => void {
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    const wrappedPushState = function pushState(
      this: History,
      ...args: Parameters<History["pushState"]>
    ): void {
      originalPushState.apply(this, args);
      schedule();
    };
    const wrappedReplaceState = function replaceState(
      this: History,
      ...args: Parameters<History["replaceState"]>
    ): void {
      originalReplaceState.apply(this, args);
      schedule();
    };

    window.history.pushState = wrappedPushState;
    window.history.replaceState = wrappedReplaceState;

    return () => {
      // Do not clobber a wrapper installed by Steam or another plugin after
      // Steam Share started. Only restore methods that still point at our own
      // wrappers; otherwise leave the newer owner untouched.
      if (window.history.pushState === wrappedPushState) {
        window.history.pushState = originalPushState;
      }
      if (window.history.replaceState === wrappedReplaceState) {
        window.history.replaceState = originalReplaceState;
      }
      restoreListeners();
    };
  }

  private scheduleReconcile(): void {
    if (this.injectionQueued) {
      return;
    }

    this.injectionQueued = true;
    window.requestAnimationFrame(() => {
      this.injectionQueued = false;
      this.reconcile();
    });
  }

  private reconcile(): void {
    const context = getSteamStoreGameContext(window.location);
    if (!context) {
      this.button.remove();
      return;
    }

    this.button.ensure({
      label: this.shareService.label,
      onActivate: (button) => {
        void this.shareCurrentGame(button);
      },
    });
  }

  private async shareCurrentGame(button: HTMLElement): Promise<void> {
    const context = getSteamStoreGameContext(window.location);
    if (!context) {
      return;
    }

    const deliveries = await this.friendPicker.open(context);
    if (!deliveries) {
      return;
    }

    // Keep the original copy-link behaviour as a useful fallback after send.
    try {
      await this.shareService.share(context);
    } catch {
      // A successful Steam message does not depend on clipboard permissions.
    }

    const sent = deliveries.filter((delivery) => delivery.sent).length;
    const failed = deliveries.length - sent;
    if (sent === 0) {
      const reason = deliveries.find((delivery) => !delivery.sent)?.error;
      this.toaster.show(
        reason ? `Couldn't send: ${reason}` : "Steam couldn't send the link",
        button,
      );
    } else if (failed === 0) {
      this.toaster.show(`Sent to ${sent} ${sent === 1 ? "friend" : "friends"}`, button);
    } else {
      this.toaster.show(`Sent to ${sent}; ${failed} failed`, button);
    }
  }
}
