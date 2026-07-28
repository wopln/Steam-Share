import type { FriendShareResult, ShareFriend } from "../domain/share-friend";
import type { ShareContext } from "../domain/share-action";
import { SteamChatBridge } from "../platform/steam-chat-bridge";

const STYLE_ID = "steam-share-picker-styles";

interface PickerElements {
  readonly backdrop: HTMLDivElement;
  readonly panel: HTMLDivElement;
  readonly search: HTMLInputElement;
  readonly count: HTMLSpanElement;
  readonly friends: HTMLDivElement;
  readonly error: HTMLDivElement;
  readonly send: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
}

/** A multi-recipient picker backed by the logged-in Steam Friends & Chat list. */
export class FriendPicker {
  private active: Promise<FriendShareResult | undefined> | undefined;

  public constructor(private readonly chat: SteamChatBridge) {}

  public open(context: ShareContext): Promise<FriendShareResult | undefined> {
    if (this.active) {
      return this.active;
    }

    this.active = this.openInternal(context).finally(() => {
      this.active = undefined;
    });
    return this.active;
  }

  private async openInternal(context: ShareContext): Promise<FriendShareResult | undefined> {
    this.installStyles();
    const elements = this.createDialog(context);
    document.body.append(elements.backdrop);
    elements.search.focus();

    try {
      const friends = await this.chat.loadFriends();
      return await this.selectRecipients(elements, friends, context);
    } catch (error) {
      elements.error.textContent =
        error instanceof Error ? error.message : "Steam Friends & Chat could not be opened.";
      elements.cancel.textContent = "Close";
      elements.search.disabled = true;
      return await new Promise<undefined>((resolve) => {
        elements.cancel.addEventListener(
          "click",
          () => {
            elements.backdrop.remove();
            resolve(undefined);
          },
          { once: true },
        );
      });
    }
  }

  private selectRecipients(
    elements: PickerElements,
    friends: readonly ShareFriend[],
    context: ShareContext,
  ): Promise<FriendShareResult | undefined> {
    const selected = new Set<string>();
    const message = `Check out ${context.title} on Steam:\n${context.url}`;

    return new Promise((resolve) => {
      const close = (result: FriendShareResult | undefined): void => {
        document.removeEventListener("keydown", onKeyDown);
        elements.backdrop.remove();
        resolve(result);
      };
      const updateSendButton = (): void => {
        const count = selected.size;
        elements.count.textContent = `${count} selected`;
        elements.send.disabled = count === 0;
        elements.send.textContent = count === 1 ? "Send to 1 friend" : `Send to ${count} friends`;
      };
      const renderFriends = (): void => {
        const query = elements.search.value.trim().toLocaleLowerCase();
        const visibleFriends = friends.filter((friend) => {
          const searchable = `${friend.displayName} ${friend.status} ${friend.gameName}`.toLocaleLowerCase();
          return searchable.includes(query);
        });

        elements.friends.replaceChildren();
        if (visibleFriends.length === 0) {
          const empty = document.createElement("div");
          empty.className = "steam-share-picker__empty";
          empty.textContent = "No friends match your search.";
          elements.friends.append(empty);
          return;
        }

        for (const friend of visibleFriends) {
          const row = document.createElement("label");
          row.className = "steam-share-picker__friend";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = selected.has(friend.steamId64);
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
              selected.add(friend.steamId64);
            } else {
              selected.delete(friend.steamId64);
            }
            updateSendButton();
          });

          const avatar = document.createElement("img");
          avatar.className = "steam-share-picker__avatar";
          avatar.src = friend.avatarUrl;
          avatar.alt = "";
          avatar.width = 32;
          avatar.height = 32;
          avatar.loading = "lazy";
          avatar.addEventListener("error", () => {
            avatar.removeAttribute("src");
            avatar.classList.add("steam-share-picker__avatar--missing");
          });

          const details = document.createElement("span");
          details.className = "steam-share-picker__friend-details";
          const name = document.createElement("strong");
          name.textContent = friend.displayName;
          const status = document.createElement("small");
          status.textContent = friend.gameName || friend.status;
          details.append(name, status);
          row.append(checkbox, avatar, details);
          elements.friends.append(row);
        }
      };
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
          close(undefined);
        }
      };

      elements.search.addEventListener("input", renderFriends);
      elements.cancel.addEventListener("click", () => close(undefined));
      elements.backdrop.addEventListener("click", (event) => {
        if (event.target === elements.backdrop) {
          close(undefined);
        }
      });
      elements.send.addEventListener("click", () => {
        void this.sendSelected(elements, selected, message, close);
      });
      document.addEventListener("keydown", onKeyDown);

      renderFriends();
      updateSendButton();
    });
  }

  private async sendSelected(
    elements: PickerElements,
    selected: ReadonlySet<string>,
    message: string,
    close: (result: FriendShareResult | undefined) => void,
  ): Promise<void> {
    elements.error.textContent = "";
    elements.send.disabled = true;
    elements.cancel.disabled = true;
    elements.send.textContent = "Sending…";

    try {
      close(await this.chat.send([...selected], message));
    } catch (error) {
      elements.error.textContent =
        error instanceof Error ? error.message : "Steam could not send the selected messages.";
      elements.cancel.disabled = false;
      elements.send.disabled = false;
      elements.send.textContent = "Try again";
    }
  }

  private createDialog(context: ShareContext): PickerElements {
    const backdrop = document.createElement("div");
    backdrop.className = "steam-share-picker-backdrop";

    const panel = document.createElement("div");
    panel.className = "steam-share-picker";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Share with Steam friends");

    const heading = document.createElement("h2");
    heading.textContent = "Share with Friends";
    const description = document.createElement("p");
    description.textContent = `Choose friends to receive a link to ${context.title}.`;
    const search = document.createElement("input");
    search.className = "steam-share-picker__search";
    search.type = "search";
    search.placeholder = "Search friends";
    search.setAttribute("aria-label", "Search friends");
    const count = document.createElement("span");
    count.className = "steam-share-picker__count";
    const friends = document.createElement("div");
    friends.className = "steam-share-picker__friends";
    const error = document.createElement("div");
    error.className = "steam-share-picker__error";
    error.setAttribute("role", "alert");
    const actions = document.createElement("div");
    actions.className = "steam-share-picker__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "steam-share-picker__button steam-share-picker__button--secondary";
    cancel.textContent = "Cancel";
    const send = document.createElement("button");
    send.type = "button";
    send.className = "steam-share-picker__button";
    actions.append(cancel, send);
    panel.append(heading, description, search, count, friends, error, actions);
    backdrop.append(panel);

    return { backdrop, panel, search, count, friends, error, send, cancel };
  }

  private installStyles(): void {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .steam-share-picker-backdrop { position: fixed; z-index: 2147483646; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(0, 0, 0, .65); }
      .steam-share-picker { width: min(440px, 100%); max-height: min(620px, calc(100vh - 48px)); display: flex; flex-direction: column; box-sizing: border-box; padding: 22px; border: 1px solid #4c6b88; background: linear-gradient(180deg, #2b3d50 0%, #172536 100%); box-shadow: 0 12px 35px rgba(0, 0, 0, .7); color: #d6d7d8; font-family: Motiva Sans, Arial, Helvetica, sans-serif; }
      .steam-share-picker h2 { margin: 0 0 6px; color: #fff; font-size: 22px; font-weight: normal; }
      .steam-share-picker p { margin: 0 0 16px; color: #a7bacc; font-size: 13px; line-height: 18px; }
      .steam-share-picker__search { box-sizing: border-box; width: 100%; margin-bottom: 9px; padding: 9px 10px; border: 1px solid #000; outline: 1px solid #4c6b88; background: #111d2a; color: #fff; font-family: inherit; }
      .steam-share-picker__count { min-height: 18px; margin-bottom: 6px; color: #8f98a0; font-size: 12px; }
      .steam-share-picker__friends { overflow: auto; min-height: 120px; border-top: 1px solid rgba(255,255,255,.08); border-bottom: 1px solid rgba(255,255,255,.08); }
      .steam-share-picker__friend { display: flex; gap: 10px; align-items: center; min-height: 48px; padding: 7px 8px; cursor: pointer; }
      .steam-share-picker__friend:hover { background: rgba(102, 192, 244, .14); }
      .steam-share-picker__friend input { width: 15px; height: 15px; accent-color: #66c0f4; }
      .steam-share-picker__avatar { width: 32px; height: 32px; flex: 0 0 32px; border: 1px solid rgba(255, 255, 255, .18); background: #263b4e; object-fit: cover; }
      .steam-share-picker__avatar--missing { border-color: rgba(255, 255, 255, .1); background: linear-gradient(135deg, #58708a, #25384a); }
      .steam-share-picker__friend-details { display: grid; min-width: 0; }
      .steam-share-picker__friend strong { overflow: hidden; color: #d6d7d8; font-size: 14px; font-weight: normal; text-overflow: ellipsis; white-space: nowrap; }
      .steam-share-picker__friend small { overflow: hidden; margin-top: 2px; color: #8f98a0; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .steam-share-picker__empty { padding: 30px 12px; color: #8f98a0; text-align: center; }
      .steam-share-picker__error { min-height: 18px; margin-top: 10px; color: #f28b82; font-size: 12px; }
      .steam-share-picker__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
      .steam-share-picker__button { min-width: 112px; padding: 8px 14px; border: 0; background: linear-gradient(to right, #47bfff 5%, #1a9fff 95%); color: #fff; cursor: pointer; font-family: inherit; font-size: 13px; }
      .steam-share-picker__button:hover:not(:disabled) { background: linear-gradient(to right, #6dccff 5%, #35b7ff 95%); }
      .steam-share-picker__button:disabled { cursor: default; opacity: .45; }
      .steam-share-picker__button--secondary { background: linear-gradient(to right, #5a6d7c 5%, #3c4e5f 95%); }
    `;
    document.head.append(style);
  }
}
