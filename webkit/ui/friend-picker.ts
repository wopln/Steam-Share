import type { FriendShareResult, ShareFriend } from "../domain/share-friend";
import type { ShareContext } from "../domain/share-action";
import { FavoritesStore } from "../services/favorites-store";
import { RecentContactsStore } from "../services/recent-contacts-store";

const STYLE_ID = "steam-share-picker-styles";

interface PickerElements {
  readonly backdrop: HTMLDivElement;
  readonly panel: HTMLDivElement;
  readonly search: HTMLInputElement;
  readonly count: HTMLSpanElement;
  readonly favorites: HTMLDivElement;
  readonly allFriendsHeading: HTMLHeadingElement;
  readonly friends: HTMLDivElement;
  readonly error: HTMLDivElement;
  readonly send: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
}

/**
 * The picker is intentionally independent from its host page. Store WebKit
 * uses the Millennium callable bridge, while the Library frontend talks to
 * the same Steam Friends session directly. Keeping this small contract here
 * guarantees both entry points render and behave identically.
 */
export interface FriendChatGateway {
  loadFriends(): Promise<readonly ShareFriend[]>;
  send(friendIds: readonly string[], message: string): Promise<FriendShareResult>;
}

/** A multi-recipient picker backed by the logged-in Steam Friends & Chat list. */
export class FriendPicker {
  private active: Promise<FriendShareResult | undefined> | undefined;
  private contextMenu: HTMLDivElement | undefined;
  private removeContextMenuListeners: (() => void) | undefined;
  private hostDocument: Document = document;

  public constructor(
    private readonly chat: FriendChatGateway,
    private readonly recentContacts: RecentContactsStore,
    private readonly favorites: FavoritesStore,
  ) {}

  public open(
    context: ShareContext,
    hostDocument: Document = document,
  ): Promise<FriendShareResult | undefined> {
    if (this.active) {
      return this.active;
    }

    this.hostDocument = hostDocument;
    this.active = this.openInternal(context).finally(() => {
      this.active = undefined;
    });
    return this.active;
  }

  private async openInternal(context: ShareContext): Promise<FriendShareResult | undefined> {
    this.installStyles();
    const elements = this.createDialog(context);
    this.hostDocument.body.append(elements.backdrop);
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
    const friendsById = new Map(friends.map((friend) => [friend.steamId64, friend]));
    const message = `Check out ${context.title} on Steam:\n${context.url}`;

    return new Promise((resolve) => {
      let renderFriends: () => void;
      const close = (result: FriendShareResult | undefined): void => {
        this.closeContextMenu();
        this.hostDocument.removeEventListener("keydown", onKeyDown);
        elements.backdrop.remove();
        resolve(result);
      };
      const updateSendButton = (): void => {
        const count = selected.size;
        elements.count.textContent = `${count} selected`;
        elements.send.disabled = count === 0;
        elements.send.textContent = count === 1 ? "Send to 1 friend" : `Send to ${count} friends`;
      };
      const createAvatar = (friend: ShareFriend, className: string, size: number): HTMLImageElement => {
        const avatar = this.hostDocument.createElement("img");
        avatar.className = className;
        avatar.src = friend.avatarUrl;
        avatar.alt = "";
        avatar.width = size;
        avatar.height = size;
        avatar.loading = "lazy";
        avatar.addEventListener("error", () => {
          avatar.removeAttribute("src");
          avatar.classList.add("steam-share-picker__avatar--missing");
        });
        return avatar;
      };
      const createFavoriteTile = (friend: ShareFriend): HTMLButtonElement => {
        const tile = this.hostDocument.createElement("button");
        tile.type = "button";
        tile.className = "steam-share-picker__favorite-tile";
        tile.draggable = true;
        tile.setAttribute("aria-pressed", String(selected.has(friend.steamId64)));
        tile.addEventListener("click", () => {
          if (selected.has(friend.steamId64)) {
            selected.delete(friend.steamId64);
          } else {
            selected.add(friend.steamId64);
          }
          renderFriends();
          updateSendButton();
        });
        tile.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          this.showFriendContextMenu(event, friend, renderFriends);
        });
        tile.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("text/plain", friend.steamId64);
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
          }
          tile.classList.add("steam-share-picker__favorite-tile--dragging");
          elements.friends.classList.add("steam-share-picker__friends--drop-target");
        });
        tile.addEventListener("dragend", () => {
          tile.classList.remove("steam-share-picker__favorite-tile--dragging");
          elements.friends.classList.remove("steam-share-picker__friends--drop-target");
        });

        const avatar = createAvatar(friend, "steam-share-picker__favorite-avatar", 56);
        if (selected.has(friend.steamId64)) {
          avatar.classList.add("steam-share-picker__favorite-avatar--selected");
        }
        const name = this.hostDocument.createElement("span");
        name.className = "steam-share-picker__favorite-name";
        name.textContent = friend.displayName;
        tile.append(avatar, name);
        return tile;
      };
      const createFriendRow = (friend: ShareFriend, isRecent: boolean): HTMLButtonElement => {
        const row = this.hostDocument.createElement("button");
        row.type = "button";
        row.className = "steam-share-picker__friend";
        row.draggable = true;
        row.setAttribute("aria-pressed", String(selected.has(friend.steamId64)));
        if (selected.has(friend.steamId64)) {
          row.classList.add("steam-share-picker__friend--selected");
        }
        row.addEventListener("click", () => {
          if (selected.has(friend.steamId64)) {
            selected.delete(friend.steamId64);
          } else {
            selected.add(friend.steamId64);
          }
          renderFriends();
          updateSendButton();
        });
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          this.showFriendContextMenu(event, friend, renderFriends);
        });
        row.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("text/plain", friend.steamId64);
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
          }
          row.classList.add("steam-share-picker__friend--dragging");
          elements.favorites.classList.add("steam-share-picker__favorites--drop-target");
        });
        row.addEventListener("dragend", () => {
          row.classList.remove("steam-share-picker__friend--dragging");
          elements.favorites.classList.remove("steam-share-picker__favorites--drop-target");
        });

        const avatar = createAvatar(friend, "steam-share-picker__avatar", 32);
        if (selected.has(friend.steamId64)) {
          avatar.classList.add("steam-share-picker__avatar--selected");
        }
        const details = this.hostDocument.createElement("span");
        details.className = "steam-share-picker__friend-details";
        const name = this.hostDocument.createElement("strong");
        name.textContent = friend.displayName;
        if (isRecent) {
          const badge = this.hostDocument.createElement("span");
          badge.className = "steam-share-picker__recent-badge";
          badge.textContent = "Recent";
          name.append(badge);
        }
        const status = this.hostDocument.createElement("small");
        status.textContent = friend.gameName || friend.status;
        details.append(name, status);
        row.append(avatar, details);
        return row;
      };

      renderFriends = (): void => {
        const query = elements.search.value.trim().toLocaleLowerCase();
        const matchesSearch = (friend: ShareFriend): boolean => {
          const searchable = `${friend.displayName} ${friend.status} ${friend.gameName}`.toLocaleLowerCase();
          return searchable.includes(query);
        };
        const favoriteFriends = friends.filter((friend) => this.favorites.has(friend.steamId64));
        const recentFriends = this.recentContacts.resolve(friends);
        const recentFriendIds = new Set(recentFriends.map((friend) => friend.steamId64));
        const nonFavoriteFriends = friends.filter((friend) => !this.favorites.has(friend.steamId64));
        const visibleFriends = [
          ...recentFriends.filter((friend) => !this.favorites.has(friend.steamId64)),
          ...nonFavoriteFriends.filter((friend) => !recentFriendIds.has(friend.steamId64)),
        ].filter(matchesSearch);

        elements.favorites.replaceChildren();
        const favoritesHeading = this.hostDocument.createElement("h3");
        favoritesHeading.className = "steam-share-picker__section-title steam-share-picker__section-title--favorites";
        favoritesHeading.textContent = "Favorites";
        const tiles = this.hostDocument.createElement("div");
        tiles.className = "steam-share-picker__favorite-tiles";
        if (favoriteFriends.length === 0) {
          const hint = this.hostDocument.createElement("span");
          hint.className = "steam-share-picker__favorites-hint";
          hint.textContent = "Drag friends here to add favorites";
          tiles.append(hint);
        } else {
          for (const friend of favoriteFriends) {
            tiles.append(createFavoriteTile(friend));
          }
        }
        elements.favorites.append(favoritesHeading, tiles);

        elements.friends.replaceChildren();
        if (visibleFriends.length === 0) {
          const empty = this.hostDocument.createElement("div");
          empty.className = "steam-share-picker__empty";
          empty.textContent = query.length > 0 ? "No friends match your search." : "No friends available.";
          elements.friends.append(empty);
          return;
        }

        for (const friend of visibleFriends) {
          elements.friends.append(createFriendRow(friend, recentFriendIds.has(friend.steamId64)));
        }
      };
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
          close(undefined);
        }
      };
      const clearFavoriteDropTarget = (): void => {
        elements.favorites.classList.remove("steam-share-picker__favorites--drop-target");
      };
      const clearAllFriendsDropTarget = (): void => {
        elements.friends.classList.remove("steam-share-picker__friends--drop-target");
      };

      elements.favorites.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        elements.favorites.classList.add("steam-share-picker__favorites--drop-target");
      });
      elements.favorites.addEventListener("dragleave", (event) => {
        if (!(event.relatedTarget instanceof Node) || !elements.favorites.contains(event.relatedTarget)) {
          clearFavoriteDropTarget();
        }
      });
      elements.favorites.addEventListener("drop", (event) => {
        event.preventDefault();
        clearFavoriteDropTarget();
        const steamId64 = event.dataTransfer?.getData("text/plain");
        if (steamId64 && friendsById.has(steamId64) && !this.favorites.has(steamId64)) {
          this.favorites.add(steamId64);
          renderFriends();
        }
      });
      elements.friends.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        elements.friends.classList.add("steam-share-picker__friends--drop-target");
      });
      elements.friends.addEventListener("dragleave", (event) => {
        if (!(event.relatedTarget instanceof Node) || !elements.friends.contains(event.relatedTarget)) {
          clearAllFriendsDropTarget();
        }
      });
      elements.friends.addEventListener("drop", (event) => {
        event.preventDefault();
        clearAllFriendsDropTarget();
        const steamId64 = event.dataTransfer?.getData("text/plain");
        if (steamId64 && friendsById.has(steamId64) && this.favorites.has(steamId64)) {
          this.favorites.remove(steamId64);
          renderFriends();
        }
      });
      elements.search.addEventListener("input", renderFriends);
      elements.cancel.addEventListener("click", () => close(undefined));
      elements.backdrop.addEventListener("click", (event) => {
        if (event.target === elements.backdrop) {
          close(undefined);
        }
      });
      elements.send.addEventListener("click", () => {
        void this.sendSelected(elements, selected, message, friends, close);
      });
      this.hostDocument.addEventListener("keydown", onKeyDown);

      renderFriends();
      updateSendButton();
    });
  }

  private showFriendContextMenu(
    event: MouseEvent,
    friend: ShareFriend,
    onFavoriteChanged: () => void,
  ): void {
    this.closeContextMenu();

    const menu = this.hostDocument.createElement("div");
    menu.className = "steam-share-picker__context-menu";
    menu.setAttribute("role", "menu");

    const action = this.hostDocument.createElement("button");
    action.type = "button";
    action.className = "steam-share-picker__context-action";
    action.setAttribute("role", "menuitem");
    const isFavorite = this.favorites.has(friend.steamId64);
    action.textContent = isFavorite ? "Remove from Favorites" : "Add to Favorites";
    action.addEventListener("click", () => {
      if (isFavorite) {
        this.favorites.remove(friend.steamId64);
      } else {
        this.favorites.add(friend.steamId64);
      }
      this.closeContextMenu();
      onFavoriteChanged();
    });

    menu.append(action);
    this.hostDocument.body.append(menu);
    const bounds = menu.getBoundingClientRect();
    const hostWindow = this.hostDocument.defaultView ?? window;
    menu.style.left = `${Math.max(8, Math.min(event.clientX, hostWindow.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, hostWindow.innerHeight - bounds.height - 8))}px`;

    const dismissOnOutsidePointerDown = (pointerEvent: PointerEvent): void => {
      if (!(pointerEvent.target instanceof Node) || !menu.contains(pointerEvent.target)) {
        this.closeContextMenu();
      }
    };
    const dismissOnEscape = (keyboardEvent: KeyboardEvent): void => {
      if (keyboardEvent.key === "Escape") {
        this.closeContextMenu();
      }
    };
    this.hostDocument.addEventListener("pointerdown", dismissOnOutsidePointerDown, true);
    this.hostDocument.addEventListener("keydown", dismissOnEscape);

    this.contextMenu = menu;
    this.removeContextMenuListeners = () => {
      this.hostDocument.removeEventListener("pointerdown", dismissOnOutsidePointerDown, true);
      this.hostDocument.removeEventListener("keydown", dismissOnEscape);
    };
  }

  private closeContextMenu(): void {
    this.contextMenu?.remove();
    this.contextMenu = undefined;
    this.removeContextMenuListeners?.();
    this.removeContextMenuListeners = undefined;
  }

  private async sendSelected(
    elements: PickerElements,
    selected: ReadonlySet<string>,
    message: string,
    friends: readonly ShareFriend[],
    close: (result: FriendShareResult | undefined) => void,
  ): Promise<void> {
    elements.error.textContent = "";
    elements.send.disabled = true;
    elements.cancel.disabled = true;
    elements.send.textContent = "Sending...";

    try {
      const deliveries = await this.chat.send([...selected], message);
      this.recentContacts.recordSuccessfulRecipients(deliveries, friends);
      close(deliveries);
    } catch (error) {
      elements.error.textContent =
        error instanceof Error ? error.message : "Steam could not send the selected messages.";
      elements.cancel.disabled = false;
      elements.send.disabled = false;
      elements.send.textContent = "Try again";
    }
  }

  private createDialog(context: ShareContext): PickerElements {
    const backdrop = this.hostDocument.createElement("div");
    backdrop.className = "steam-share-picker-backdrop";

    const panel = this.hostDocument.createElement("div");
    panel.className = "steam-share-picker";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Share with Steam friends");

    const heading = this.hostDocument.createElement("h2");
    heading.textContent = "Share with Friends";
    const description = this.hostDocument.createElement("p");
    description.textContent = `Choose friends to receive a link to ${context.title}.`;
    const search = this.hostDocument.createElement("input");
    search.className = "steam-share-picker__search";
    search.type = "search";
    search.placeholder = "Search friends";
    search.setAttribute("aria-label", "Search friends");
    const count = this.hostDocument.createElement("span");
    count.className = "steam-share-picker__count";
    const favorites = this.hostDocument.createElement("div");
    favorites.className = "steam-share-picker__favorites";
    const allFriendsHeading = this.hostDocument.createElement("h3");
    allFriendsHeading.className = "steam-share-picker__section-title steam-share-picker__section-title--all";
    allFriendsHeading.textContent = "All Friends";
    const friends = this.hostDocument.createElement("div");
    friends.className = "steam-share-picker__friends";
    const error = this.hostDocument.createElement("div");
    error.className = "steam-share-picker__error";
    error.setAttribute("role", "alert");
    const actions = this.hostDocument.createElement("div");
    actions.className = "steam-share-picker__actions";
    const cancel = this.hostDocument.createElement("button");
    cancel.type = "button";
    cancel.className = "steam-share-picker__button steam-share-picker__button--secondary";
    cancel.textContent = "Cancel";
    const send = this.hostDocument.createElement("button");
    send.type = "button";
    send.className = "steam-share-picker__button";
    actions.append(cancel, send);
    panel.append(
      heading,
      description,
      search,
      count,
      favorites,
      allFriendsHeading,
      friends,
      error,
      actions,
    );
    backdrop.append(panel);

    return {
      backdrop,
      panel,
      search,
      count,
      favorites,
      allFriendsHeading,
      friends,
      error,
      send,
      cancel,
    };
  }

  private installStyles(): void {
    if (this.hostDocument.getElementById(STYLE_ID)) {
      return;
    }

    const style = this.hostDocument.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .steam-share-picker-backdrop { position: fixed; z-index: 2147483646; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(0, 0, 0, .65); }
      .steam-share-picker { width: min(440px, 100%); height: min(620px, calc(100vh - 48px)); display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; padding: 22px; border: 1px solid #4c6b88; background: linear-gradient(180deg, #2b3d50 0%, #172536 100%); box-shadow: 0 12px 35px rgba(0, 0, 0, .7); color: #d6d7d8; font-family: Motiva Sans, Arial, Helvetica, sans-serif; }
      .steam-share-picker h2 { margin: 0 0 6px; color: #fff; font-size: 22px; font-weight: normal; }
      .steam-share-picker p { margin: 0 0 16px; color: #a7bacc; font-size: 13px; line-height: 18px; }
      .steam-share-picker__search { box-sizing: border-box; width: 100%; margin-bottom: 9px; padding: 9px 10px; border: 1px solid #000; outline: 1px solid #4c6b88; background: #111d2a; color: #fff; font-family: inherit; }
      .steam-share-picker__count { min-height: 18px; margin-bottom: 6px; color: #8f98a0; font-size: 12px; }
      .steam-share-picker__favorites { flex: 0 0 auto; margin-bottom: 8px; border-top: 1px solid rgba(255,255,255,.08); border-bottom: 1px solid rgba(255,255,255,.08); transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease; }
      .steam-share-picker__favorites--drop-target { border-color: rgba(102,192,244,.8); background: rgba(102,192,244,.08); box-shadow: inset 0 0 18px rgba(102,192,244,.12); }
      .steam-share-picker__section-title { margin: 0; padding: 8px 8px 6px; color: #fff; font-size: 16px; font-weight: normal; text-transform: none; }
      .steam-share-picker__section-title--all { padding: 2px 8px 6px; }
      .steam-share-picker__favorite-tiles { display: flex; flex-wrap: wrap; gap: 10px 12px; min-height: 78px; padding: 0 8px 10px; }
      .steam-share-picker__favorites-hint { align-self: center; padding: 13px 0; color: #8f98a0; font-size: 12px; font-style: italic; }
      .steam-share-picker__favorite-tile { display: grid; justify-items: center; width: 64px; padding: 0; border: 0; background: transparent; color: #d6d7d8; cursor: pointer; font-family: inherit; }
      .steam-share-picker__favorite-tile:focus { outline: 0; }
      .steam-share-picker__favorite-tile--dragging { opacity: .42; }
      .steam-share-picker__favorite-avatar { width: 56px; height: 56px; border: 1px solid rgba(255,255,255,.2); background: #263b4e; object-fit: cover; transform: scale(1); transition: transform 175ms ease, border-color 175ms ease, box-shadow 175ms ease; }
      .steam-share-picker__favorite-tile:hover .steam-share-picker__favorite-avatar, .steam-share-picker__favorite-tile:focus .steam-share-picker__favorite-avatar { border-color: rgba(102,192,244,.65); }
      .steam-share-picker__favorite-avatar--selected { border-color: #66c0f4; box-shadow: 0 0 9px rgba(102,192,244,.85), 0 0 18px rgba(102,192,244,.34); transform: scale(1.07); }
      .steam-share-picker__favorite-name { width: 100%; overflow: hidden; margin-top: 5px; color: #d6d7d8; font-size: 12px; line-height: 15px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
      .steam-share-picker__friends { flex: 1 1 120px; min-height: 120px; overflow-y: auto; border-top: 1px solid rgba(255,255,255,.08); border-bottom: 1px solid rgba(255,255,255,.08); transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease; }
      .steam-share-picker__friends--drop-target { border-color: rgba(102,192,244,.8); background: rgba(102,192,244,.08); box-shadow: inset 0 0 18px rgba(102,192,244,.12); }
      .steam-share-picker__friend { display: flex; width: 100%; gap: 10px; align-items: center; min-height: 48px; padding: 7px 8px; border: 0; background: transparent; color: inherit; cursor: pointer; font-family: inherit; text-align: left; }
      .steam-share-picker__friend:hover, .steam-share-picker__friend:focus { outline: 0; background: rgba(102, 192, 244, .14); }
      .steam-share-picker__friend--selected { background: rgba(102, 192, 244, .24); box-shadow: inset 2px 0 0 rgba(102,192,244,.7); }
      .steam-share-picker__friend--dragging { opacity: .42; }
      .steam-share-picker__avatar { width: 32px; height: 32px; flex: 0 0 32px; border: 1px solid rgba(255, 255, 255, .18); background: #263b4e; object-fit: cover; transform: scale(1); transition: transform 175ms ease, border-color 175ms ease, box-shadow 175ms ease; }
      .steam-share-picker__avatar--selected { border-color: #66c0f4; box-shadow: 0 0 7px rgba(102,192,244,.75), 0 0 14px rgba(102,192,244,.28); transform: scale(1.07); }
      .steam-share-picker__avatar--missing { border-color: rgba(255, 255, 255, .1); background: linear-gradient(135deg, #58708a, #25384a); }
      .steam-share-picker__friend-details { display: grid; min-width: 0; }
      .steam-share-picker__friend strong { overflow: hidden; color: #d6d7d8; font-size: 14px; font-weight: normal; text-overflow: ellipsis; white-space: nowrap; }
      .steam-share-picker__recent-badge { display: inline-block; margin-left: 6px; padding: 1px 4px; border: 1px solid rgba(102,192,244,.35); border-radius: 2px; color: #9fd7f6; font-size: 10px; font-weight: normal; line-height: 12px; vertical-align: 1px; }
      .steam-share-picker__friend small { overflow: hidden; margin-top: 2px; color: #8f98a0; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .steam-share-picker__context-menu { position: fixed; z-index: 2147483647; min-width: 186px; padding: 4px; border: 1px solid #5a7b99; background: linear-gradient(180deg, #2b3d50 0%, #182736 100%); box-shadow: 0 5px 18px rgba(0, 0, 0, .65); font-family: Motiva Sans, Arial, Helvetica, sans-serif; }
      .steam-share-picker__context-action { display: block; width: 100%; padding: 8px 10px; border: 0; background: transparent; color: #d6d7d8; cursor: pointer; font: inherit; font-size: 13px; text-align: left; }
      .steam-share-picker__context-action:hover, .steam-share-picker__context-action:focus { outline: 0; background: rgba(102, 192, 244, .22); color: #fff; }
      .steam-share-picker__empty { padding: 30px 12px; color: #8f98a0; text-align: center; }
      .steam-share-picker__error { min-height: 18px; margin-top: 10px; color: #f28b82; font-size: 12px; }
      .steam-share-picker__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
      .steam-share-picker__button { min-width: 112px; padding: 8px 14px; border: 0; background: linear-gradient(to right, #47bfff 5%, #1a9fff 95%); color: #fff; cursor: pointer; font-family: inherit; font-size: 13px; }
      .steam-share-picker__button:hover:not(:disabled) { background: linear-gradient(to right, #6dccff 5%, #35b7ff 95%); }
      .steam-share-picker__button:disabled { cursor: default; opacity: .45; }
      .steam-share-picker__button--secondary { background: linear-gradient(to right, #5a6d7c 5%, #3c4e5f 95%); }
    `;
    this.hostDocument.head.append(style);
  }
}
