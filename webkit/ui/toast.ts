const TOAST_ID = "steam-share-toast";
const STYLE_ID = "steam-share-toast-styles";
const DISPLAY_DURATION_MS = 1_800;

/** A compact, pointer-safe status bubble positioned above the pressed action. */
export class ToastPresenter {
  private timeoutId: number | undefined;

  public show(message: string, anchor: HTMLElement): void {
    this.installStyles();

    const toast = this.getToast();
    toast.textContent = message;
    toast.classList.remove("steam-share-toast--visible");
    toast.hidden = false;

    this.positionToast(toast, anchor);
    window.requestAnimationFrame(() => toast.classList.add("steam-share-toast--visible"));

    if (this.timeoutId !== undefined) {
      window.clearTimeout(this.timeoutId);
    }

    this.timeoutId = window.setTimeout(() => {
      toast.classList.remove("steam-share-toast--visible");
      this.timeoutId = undefined;
    }, DISPLAY_DURATION_MS);
  }

  private getToast(): HTMLDivElement {
    const existing = document.getElementById(TOAST_ID);
    if (existing instanceof HTMLDivElement) {
      return existing;
    }

    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.className = "steam-share-toast";
    toast.hidden = true;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.append(toast);
    return toast;
  }

  private positionToast(toast: HTMLElement, anchor: HTMLElement): void {
    const anchorBounds = anchor.getBoundingClientRect();
    const toastWidth = toast.offsetWidth;
    const toastHeight = toast.offsetHeight;
    const preferredLeft = anchorBounds.left + (anchorBounds.width - toastWidth) / 2;
    const left = Math.min(
      Math.max(8, preferredLeft),
      Math.max(8, window.innerWidth - toastWidth - 8),
    );
    const top = anchorBounds.top - toastHeight - 8;

    toast.style.left = `${Math.round(left)}px`;
    toast.style.top = `${Math.round(Math.max(8, top))}px`;
  }

  private installStyles(): void {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .steam-share-toast {
        position: fixed;
        z-index: 2147483647;
        box-sizing: border-box;
        max-width: min(280px, calc(100vw - 16px));
        padding: 7px 10px;
        border: 1px solid rgba(102, 192, 244, 0.3);
        border-radius: 2px;
        background: rgba(23, 26, 33, 0.96);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
        color: #d6d7d8;
        font-family: Motiva Sans, Arial, Helvetica, sans-serif;
        font-size: 12px;
        line-height: 16px;
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 150ms ease, transform 150ms ease;
      }
      .steam-share-toast--visible {
        opacity: 1;
        transform: translateY(0);
      }
    `;
    document.head.append(style);
  }
}
