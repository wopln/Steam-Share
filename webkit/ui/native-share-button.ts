const BUTTON_ID = "steam-share-action";
const ACTION_HOST_SELECTOR = ".queue_actions_ctn";
const NATIVE_CONTROL_SELECTOR =
  ".queue_btn_ignore, .queue_btn_follow, #add_to_wishlist_area, .queue_control_button:not(.right)";
const NATIVE_BUTTON_SELECTOR =
  ".queue_btn_inactive, .btnv6_blue_hoverfade, .btnv6_lightblue_blue";

export interface NativeShareButtonOptions {
  readonly label: string;
  readonly onActivate: (button: HTMLElement) => void;
}

/**
 * Builds the control from Steam's active Follow/Ignore markup. The button then
 * inherits Steam's own dimensions, typography, hover animation, and theme CSS.
 */
export class NativeShareButton {
  public ensure(options: NativeShareButtonOptions): void {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const actionHost = document.querySelector<HTMLElement>(ACTION_HOST_SELECTOR);
    if (!actionHost) {
      return;
    }

    const nativeControl = actionHost.querySelector<HTMLElement>(NATIVE_CONTROL_SELECTOR);
    if (!nativeControl) {
      return;
    }

    const control = this.createControl(nativeControl, options);
    // Ignore is the final native action; this keeps Share in the same left-hand
    // group rather than next to Steam's right-aligned "View Your Queue" link.
    nativeControl.insertAdjacentElement("afterend", control);
  }

  public remove(): void {
    document.getElementById(BUTTON_ID)?.remove();
  }

  private createControl(
    nativeControl: HTMLElement,
    options: NativeShareButtonOptions,
  ): HTMLElement {
    const wrapper = document.createElement("div");
    if (nativeControl.classList.contains("queue_control_button")) {
      wrapper.className = nativeControl.className;
    }
    wrapper.id = BUTTON_ID;
    wrapper.classList.remove(
      "queue_btn_follow",
      "queue_btn_ignore",
      "queue_btn_inactive",
      "queue_btn_active",
      "right",
    );
    wrapper.classList.add("queue_control_button", "steam-share-control");

    const nativeButton = nativeControl.matches(NATIVE_BUTTON_SELECTOR)
      ? nativeControl
      : nativeControl.querySelector<HTMLElement>(NATIVE_BUTTON_SELECTOR);
    const button = nativeButton?.cloneNode(false) as HTMLElement | undefined;
    const interactive = button ?? document.createElement("div");
    interactive.classList.remove("queue_btn_inactive", "queue_btn_active");
    interactive.removeAttribute("id");
    interactive.removeAttribute("href");
    interactive.removeAttribute("onclick");
    interactive.style.removeProperty("display");
    interactive.setAttribute("role", "button");
    interactive.setAttribute("tabindex", "0");
    interactive.setAttribute("aria-label", "Share this game");
    interactive.setAttribute("data-tooltip-text", "Share this game with your friends");
    interactive.append(this.createLabel(options.label));

    const activate = (event: Event): void => {
      event.preventDefault();
      options.onActivate(interactive);
    };
    interactive.addEventListener("click", activate);
    interactive.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        activate(event);
      }
    });

    wrapper.append(interactive);
    return wrapper;
  }

  private createLabel(label: string): HTMLSpanElement {
    const span = document.createElement("span");
    span.textContent = label;
    return span;
  }
}
