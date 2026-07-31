import {
  Millennium,
  definePlugin,
  afterPatch,
  MenuItem,
  ModalRoot,
  showModal,
} from "@steambrew/client";
import { FriendPicker } from "../webkit/ui/friend-picker";
import { FavoritesStore } from "../webkit/services/favorites-store";
import { RecentContactsStore } from "../webkit/services/recent-contacts-store";

const LIBRARY_MENU_ITEM_ID = "steam-share-library-context-action";
const LIBRARY_DETAILS_BUTTON_ID = "steam-share-library-details-action";
const LIBRARY_INTEGRATION_KEY = "__steamShareLibraryIntegration__";

function getFriendsApplication() {
  const application = globalThis.g_FriendsUIApp;
  if (!application?.m_FriendStore || !application?.m_ChatStore?.m_FriendChatStore) {
    throw new Error("Steam Friends & Chat is not ready yet.");
  }

  return application;
}

function getFriends() {
  const application = getFriendsApplication();
  const friends = application.m_FriendStore.all_friends;
  if (!Array.isArray(friends)) {
    throw new Error("Steam is still loading your friend list.");
  }

  // The Millennium frontend-to-WebKit bridge only carries primitive values.
  // Keep this as a JSON string so the complete array crosses the boundary.
  return JSON.stringify(
    friends
      .filter((friend) => friend.is_friend !== false)
      .map((friend) => {
        const steamId64 = String(friend.steamid64);
        return {
          steamId64,
          displayName: String(friend.display_name || friend.primary_display_name || "Steam Friend"),
          status: String(friend.localized_online_status || "Offline"),
          gameName: String(friend.current_game_name || ""),
          avatarUrl: String(friend.m_persona?.avatar_url_medium || ""),
        };
      }),
  );
}

function normalizeFriends(payload) {
  let friends;
  try {
    friends = JSON.parse(String(payload));
  } catch {
    throw new Error("Steam returned an invalid friend list.");
  }

  if (!Array.isArray(friends)) {
    throw new Error("Steam returned an invalid friend list.");
  }

  return friends
    .filter(Boolean)
    .map((friend) => ({
      steamId64: String(friend.steamId64 || ""),
      displayName: String(friend.displayName || "Steam Friend"),
      status: String(friend.status || "Offline"),
      gameName: String(friend.gameName || ""),
      avatarUrl: String(friend.avatarUrl || ""),
    }))
    .filter((friend) => friend.steamId64.length > 0)
    .sort((first, second) => {
      const firstOffline = first.status.toLowerCase() === "offline";
      const secondOffline = second.status.toLowerCase() === "offline";
      if (firstOffline !== secondOffline) {
        return Number(firstOffline) - Number(secondOffline);
      }
      return first.displayName.localeCompare(second.displayName);
    });
}

async function sendGameLink(requestPayload) {
  let request;
  try {
    request = JSON.parse(String(requestPayload));
  } catch {
    throw new Error("Invalid share request.");
  }

  if (!Array.isArray(request?.friendIds) || typeof request?.message !== "string") {
    throw new Error("Invalid share request.");
  }

  const application = getFriendsApplication();
  const friendById = new Map(
    application.m_FriendStore.all_friends.map((friend) => [String(friend.steamid64), friend]),
  );
  const friendIds = [...new Set(request.friendIds)];

  const deliveries = await Promise.all(
    friendIds.map(async (steamId64) => {
      try {
        const friend = friendById.get(steamId64);
        if (!friend) {
          throw new Error("Friend is no longer available.");
        }

        // GetFriendChat expects Steam's numeric account ID, not its SteamID
        // object. Passing the object makes Steam compose an invalid recipient
        // and the chat service responds with "NotFriends".
        const accountId = Number(friend.accountid ?? friend.steamid?.GetAccountID?.());
        if (!Number.isSafeInteger(accountId) || accountId <= 0) {
          throw new Error("Steam could not identify this friend.");
        }

        const chat = application.m_ChatStore.m_FriendChatStore.GetFriendChat(accountId);
        if (typeof chat?.SendChatMessageInternal !== "function") {
          throw new Error("Steam chat is not available for this friend.");
        }

        // Private Steam Friends UI API. The Share dialog always requires an
        // explicit user Send click before this method is called.
        const result = await chat.SendChatMessageInternal(request.message);
        if (result !== 0) {
          throw new Error(`Steam rejected the message (status ${result}).`);
        }

        return { steamId64, sent: true };
      } catch (error) {
        return {
          steamId64,
          sent: false,
          error: error instanceof Error ? error.message : "Steam could not send the message.",
        };
      }
    }),
  );

  return JSON.stringify(deliveries);
}

/**
 * The Library frontend has direct access to Steam Friends & Chat. It provides
 * the same small gateway consumed by the Store WebKit picker, which keeps all
 * picker UI and selection behaviour shared between the two entry points.
 */
const libraryChatGateway = {
  async loadFriends() {
    return normalizeFriends(getFriends());
  },
  async send(friendIds, message) {
    const payload = await sendGameLink(JSON.stringify({ friendIds, message }));
    try {
      const deliveries = JSON.parse(payload);
      if (!Array.isArray(deliveries)) {
        throw new Error();
      }
      return deliveries;
    } catch {
      throw new Error("Steam returned an invalid share result.");
    }
  },
};

let libraryPicker;

function getLibraryPicker() {
  if (!libraryPicker) {
    libraryPicker = new FriendPicker(
      libraryChatGateway,
      new RecentContactsStore(),
      new FavoritesStore(),
    );
  }
  return libraryPicker;
}

function isVisible(element) {
  // Context-menu elements live in a different Steam window. CSS APIs must be
  // called by that element's own window, not by the shared plugin window.
  const style = element.ownerDocument?.defaultView?.getComputedStyle(element);
  const bounds = element.getBoundingClientRect();
  return (
    style?.display !== "none" &&
    style?.visibility !== "hidden" &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

function normaliseAppId(value) {
  const text = String(value || "").trim();
  return /^\d{1,10}$/.test(text) && Number(text) > 0 ? text : undefined;
}

function readAppIdFromObject(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  for (const key of ["appid", "appId", "unAppID", "app_id"]) {
    const appId = normaliseAppId(value[key]);
    if (appId) {
      return appId;
    }
  }

  for (const key of ["app", "overview", "game", "appOverview", "selectedApp"]) {
    const appId = readAppIdFromObject(value[key]);
    if (appId) {
      return appId;
    }
  }

  return undefined;
}

function readTitleFromObject(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  for (const key of ["display_name", "displayName", "strDisplayName", "name", "title"]) {
    const title = value[key];
    if (typeof title === "string" && title.trim().length > 0) {
      return title.trim();
    }
  }

  for (const key of ["app", "overview", "game", "appOverview", "selectedApp"]) {
    const title = readTitleFromObject(value[key]);
    if (title) {
      return title;
    }
  }

  return undefined;
}

function readReactData(element) {
  let node = element;
  while (node) {
    const fiberKey = Object.keys(node).find(
      (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"),
    );
    const fiber = fiberKey ? node[fiberKey] : undefined;
    let current = fiber;
    for (let depth = 0; current && depth < 40; depth += 1) {
      const data = [current.memoizedProps, current.pendingProps, current.stateNode?.props].find(
        (candidate) => readAppIdFromObject(candidate),
      );
      if (data) {
        return {
          appId: readAppIdFromObject(data),
          title: readTitleFromObject(data),
        };
      }
      current = current.return;
    }
    node = node.parentElement;
  }

  return {};
}

function getLibraryGameContext(target) {
  // The Library runs in Steam's desktop popup, while this plugin runs in the
  // shared JS context. `instanceof Element` is false across those windows.
  if (!target || target.nodeType !== 1) {
    return undefined;
  }

  let appId;
  let title;
  let node = target;
  while (node && !appId) {
    appId = normaliseAppId(
      node.getAttribute("data-appid") ||
        node.getAttribute("data-app-id") ||
        node.getAttribute("data-app_id"),
    );
    title = title || node.getAttribute("data-name") || node.getAttribute("aria-label") || undefined;
    node = node.parentElement;
  }

  const reactData = readReactData(target);
  appId = appId || reactData.appId;
  if (!appId) {
    return undefined;
  }

  const overview = globalThis.appStore?.GetAppOverviewByAppID?.(Number(appId));
  const gameTitle = overview?.display_name || title || reactData.title || `Steam game ${appId}`;
  return {
    appId,
    title: String(gameTitle),
    url: `https://store.steampowered.com/app/${appId}/`,
  };
}

function setMenuItemLabel(item) {
  const leaves = [...item.querySelectorAll("*")].filter(
    (element) => element.children.length === 0 && element.textContent?.trim(),
  );
  const label = leaves.sort((first, second) => second.textContent.length - first.textContent.length)[0];
  if (label) {
    label.textContent = "Share";
  } else {
    item.textContent = "Share";
  }
}

function showLibraryToast(message, anchor) {
  document.getElementById("steam-share-library-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "steam-share-library-toast";
  toast.textContent = message;
  toast.style.cssText =
    "position:fixed;z-index:2147483647;max-width:280px;padding:9px 12px;border:1px solid #4c6b88;background:#1b2838;color:#d6d7d8;box-shadow:0 4px 12px rgba(0,0,0,.55);font:13px Motiva Sans,Arial,sans-serif;";
  const bounds = anchor?.getBoundingClientRect();
  toast.style.left = `${Math.max(10, Math.min(bounds?.left ?? 20, window.innerWidth - 290))}px`;
  toast.style.top = `${Math.max(10, Math.min((bounds?.bottom ?? 20) + 8, window.innerHeight - 42))}px`;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

function LibraryPickerModalHost({ context, onFinished }) {
  const host = globalThis.SP_REACT.useRef(null);
  const started = globalThis.SP_REACT.useRef(false);

  globalThis.SP_REACT.useEffect(() => {
    if (started.current || !host.current?.ownerDocument) {
      return undefined;
    }

    started.current = true;
    void getLibraryPicker().open(context, host.current.ownerDocument).then(onFinished);
    return undefined;
  }, [context, onFinished]);

  return globalThis.SP_REACT.createElement(
    ModalRoot,
    {
      closeModal: () => onFinished(undefined),
      bDisableBackgroundDismiss: true,
      bHideCloseIcon: true,
      bHideActionIcons: true,
    },
    globalThis.SP_REACT.createElement("div", { ref: host }),
  );
}

function shareLibraryGame(context) {
  let modal;
  let completed = false;
  const finish = (deliveries) => {
    if (completed) {
      return;
    }
    completed = true;
    modal?.Close();
    if (!deliveries) {
      return;
    }

    void navigator.clipboard?.writeText(context.url).catch(() => {
      // A successful Steam message remains useful even if this context denies clipboard access.
    });

    const sent = deliveries.filter((delivery) => delivery.sent).length;
    const failed = deliveries.length - sent;
    if (sent === 0) {
      const reason = deliveries.find((delivery) => !delivery.sent)?.error;
      showLibraryToast(reason ? `Couldn't send: ${reason}` : "Steam couldn't send the link");
    } else if (failed === 0) {
      showLibraryToast(`Sent to ${sent} ${sent === 1 ? "friend" : "friends"}`);
    } else {
      showLibraryToast(`Sent to ${sent}; ${failed} failed`);
    }
  };

  modal = showModal(
    globalThis.SP_REACT.createElement(LibraryPickerModalHost, { context, onFinished: finish }),
    undefined,
    {
      strTitle: "Share with Friends",
      popupWidth: 500,
      popupHeight: 680,
      bForcePopOut: true,
      bHideActionIcons: true,
      fnOnClose: () => finish(undefined),
    },
  );
}

function findAppInValue(value, visited, depth = 0) {
  if (!value || typeof value !== "object" || visited.has(value) || depth > 6) {
    return undefined;
  }
  visited.add(value);
  const appId = readAppIdFromObject(value);
  if (appId) {
    return { appId, title: readTitleFromObject(value) };
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "_owner" || key === "return" || key === "child" || key === "sibling") {
      continue;
    }
    const found = findAppInValue(child, visited, depth + 1);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function findAppInReactTree() {
  const roots = [document.body, document.getElementById("popup_target")].filter(Boolean);
  const visited = new Set();
  const work = [];

  for (const element of roots) {
    const rootKey = Object.keys(element).find(
      (key) => key.startsWith("__reactContainer$") || key.startsWith("__reactFiber$") || key === "_reactRootContainer",
    );
    let root = rootKey ? element[rootKey] : undefined;
    root = root?._internalRoot?.current || root?.current || root;
    if (root) {
      work.push(root);
    }
  }

  while (work.length > 0 && visited.size < 2500) {
    const value = work.pop();
    if (!value || typeof value !== "object" || visited.has(value)) {
      continue;
    }
    visited.add(value);
    const propsApp = findAppInValue(value.memoizedProps, visited);
    if (propsApp) {
      return propsApp;
    }
    const pendingPropsApp = findAppInValue(value.pendingProps, visited);
    if (pendingPropsApp) {
      return pendingPropsApp;
    }

    for (const key of ["memoizedProps", "pendingProps", "memoizedState", "child", "sibling", "return"]) {
      if (value[key]) {
        work.push(value[key]);
      }
    }
  }

  return undefined;
}

function getPopupLibraryGameContext() {
  const opener = window.opener;
  const integration = opener?.[LIBRARY_INTEGRATION_KEY];
  const lastContext = integration?.getLastLibraryContext?.();
  if (lastContext) {
    return lastContext;
  }

  const reactData = findAppInReactTree();
  if (!reactData?.appId) {
    return undefined;
  }
  const overview = opener?.appStore?.GetAppOverviewByAppID?.(Number(reactData.appId));
  return {
    appId: reactData.appId,
    title: String(overview?.display_name || reactData.title || `Steam game ${reactData.appId}`),
    url: `https://store.steampowered.com/app/${reactData.appId}/`,
  };
}

function addLibraryShareItemToNativeMenu(popupWindow, getLastLibraryContext) {
  const popupDocument = popupWindow?.document;
  if (!popupDocument || popupDocument.getElementById(LIBRARY_MENU_ITEM_ID)) {
    return true;
  }

  const favoriteItem = [...popupDocument.querySelectorAll("[role='menuitem']")].find(
    (item) => isVisible(item) && item.textContent?.trim() === "Add to Favorites",
  );
  if (!favoriteItem) {
    return false;
  }

  const item = favoriteItem.cloneNode(true);
  item.id = LIBRARY_MENU_ITEM_ID;
  item.removeAttribute("disabled");
  item.removeAttribute("aria-disabled");
  item.setAttribute("role", "menuitem");
  setMenuItemLabel(item);
  item.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const context = getLastLibraryContext();
      if (context) {
        shareLibraryGame(context);
      }
      popupWindow.close();
    },
    true,
  );
  favoriteItem.after(item);
  return true;
}

function installNativeLibraryContextMenuItem(popupWindow, getLastLibraryContext) {
  const popupDocument = popupWindow?.document;
  if (!popupDocument?.documentElement) {
    return () => {};
  }

  let queued = false;
  let stopped = false;
  const addWhenReady = () => {
    queued = false;
    if (!stopped) {
      addLibraryShareItemToNativeMenu(popupWindow, getLastLibraryContext);
    }
  };
  const schedule = () => {
    if (!queued && !stopped) {
      queued = true;
      popupWindow.setTimeout(addWhenReady, 0);
    }
  };

  // Steam reuses one native context-menu window. Watch that window so the
  // Share row is added every time its contents become a Library game menu.
  const observer = new popupWindow.MutationObserver(schedule);
  observer.observe(popupDocument.documentElement, { childList: true, subtree: true });
  schedule();

  return () => {
    stopped = true;
    observer.disconnect();
  };
}

function installLibraryContextTracking(libraryWindow, setLastLibraryContext) {
  const libraryDocument = libraryWindow?.document;
  if (!libraryDocument) {
    return () => {};
  }

  const onContextMenu = (event) => {
    const context = getLibraryGameContext(event.target);
    if (context) {
      setLastLibraryContext(context);
    }
  };

  libraryDocument.addEventListener("contextmenu", onContextMenu, true);
  return () => {
    libraryDocument.removeEventListener("contextmenu", onContextMenu, true);
  };
}

function createLibraryShareIcon(popupDocument) {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = popupDocument.createElementNS(namespace, "svg");
  icon.setAttribute("class", "SVGIcon_Button SVGIcon_Share");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");

  const path = popupDocument.createElementNS(namespace, "path");
  path.setAttribute(
    "d",
    "M18 16.08c-.76 0-1.44.3-1.96.77l-7.12-4.15c.05-.22.08-.46.08-.7s-.03-.48-.08-.7l7.04-4.11A2.99 2.99 0 1 0 15 5a3 3 0 0 0 .05.54L8 9.65a3 3 0 1 0 0 4.7l7.05 4.11A2.96 2.96 0 0 0 15 19a3 3 0 1 0 3-2.92Z",
  );
  path.setAttribute("fill", "currentColor");
  icon.append(path);
  return icon;
}

function addLibraryDetailsShareButton(libraryWindow) {
  const libraryDocument = libraryWindow?.document;
  if (!libraryDocument || libraryDocument.getElementById(LIBRARY_DETAILS_BUTTON_ID)) {
    return true;
  }

  const manageButton = [...libraryDocument.querySelectorAll("[role='button'][aria-label='Manage']")].find(
    (button) => isVisible(button) && getLibraryGameContext(button)?.appId,
  );
  if (!manageButton) {
    return false;
  }

  const shareButton = manageButton.cloneNode(false);
  shareButton.id = LIBRARY_DETAILS_BUTTON_ID;
  shareButton.setAttribute("aria-label", "Share");
  shareButton.setAttribute("title", "Share this game with your friends");
  shareButton.replaceChildren(createLibraryShareIcon(libraryDocument));

  const openShareDialog = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const gameContext = getLibraryGameContext(manageButton);
    if (gameContext) {
      shareLibraryGame(gameContext);
    }
  };
  shareButton.addEventListener("click", openShareDialog, true);
  shareButton.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      openShareDialog(event);
    }
  });

  // The existing gear is Steam's final action in this group. Insert the new
  // action immediately before it so the order remains Share, then Manage.
  manageButton.before(shareButton);
  return true;
}

function installLibraryDetailsShareButton(libraryWindow) {
  const libraryDocument = libraryWindow?.document;
  if (!libraryDocument?.documentElement) {
    return () => {};
  }

  let queued = false;
  let stopped = false;
  const ensureButton = () => {
    queued = false;
    if (!stopped) {
      addLibraryDetailsShareButton(libraryWindow);
    }
  };
  const schedule = () => {
    if (!queued && !stopped) {
      queued = true;
      libraryWindow.setTimeout(ensureButton, 0);
    }
  };

  // Navigation between games replaces the details header. Observe the Steam
  // desktop document so the single Share action is restored for each game.
  const observer = new libraryWindow.MutationObserver(schedule);
  observer.observe(libraryDocument.documentElement, { childList: true, subtree: true });
  schedule();

  return () => {
    stopped = true;
    observer.disconnect();
  };
}

function installLibraryDetailsWindows(debug) {
  const teardowns = [];
  const desktopWindows = new WeakSet();
  let active = true;

  const attachWindow = (context) => {
    if (!active || !context?.m_popup) {
      return;
    }

    const name = String(context.m_strName || "");
    const title = String(context.m_strTitle || "");
    debug.windows.push(`${name}:${title}`);

    if (name.startsWith("SP Desktop_") && !desktopWindows.has(context.m_popup)) {
      desktopWindows.add(context.m_popup);
      teardowns.push(installLibraryDetailsShareButton(context.m_popup));
    }
  };

  // Millennium supplies every existing Steam window immediately and invokes
  // this callback for newly created windows as well.
  Millennium.AddWindowCreateHook?.(attachWindow);

  return () => {
    active = false;
    teardowns.splice(0).forEach((teardown) => teardown());
  };
}

function getLibraryMenuContext(menu) {
  const overview = menu.props?.overview || menu.GetTargetApps?.()[0];
  const appId = normaliseAppId(overview?.appid);
  if (!appId) {
    return undefined;
  }

  return {
    appId,
    title: String(overview.display_name || `Steam game ${appId}`),
    url: `https://store.steampowered.com/app/${appId}/`,
  };
}

function injectNativeLibraryShareItem(
  menu,
  renderedMenu,
  debug,
) {
  debug.renderCount += 1;
  const children = renderedMenu?.props?.children;
  if (!Array.isArray(children)) {
    return renderedMenu;
  }

  debug.labels = children.map((child) => String(child?.props?.children ?? ""));

  const favoriteIndex = children.findIndex((child) => {
    const label = child?.props?.children;
    return label === "Add to Favorites" || label === "Remove from Favorites";
  });
  debug.favoriteIndex = favoriteIndex;
  if (
    favoriteIndex < 0 ||
    children.some((child) => child?.props?.[LIBRARY_MENU_ITEM_ID])
  ) {
    return renderedMenu;
  }

  const shareItem = globalThis.SP_REACT.createElement(
    MenuItem,
    {
      key: "steam-share-library-context",
      [LIBRARY_MENU_ITEM_ID]: true,
      onSelected: () => {
        const context = getLibraryMenuContext(menu);
        if (context) {
          shareLibraryGame(context);
        }
      },
    },
    "Share",
  );
  const nextChildren = [...children];
  nextChildren.splice(favoriteIndex + 1, 0, shareItem);
  return {
    ...renderedMenu,
    props: {
      ...renderedMenu.props,
      children: nextChildren,
    },
  };
}

function installLibraryContextMenuPatch(debug) {
  const jsxFactory = globalThis.SP_JSX_FACTORY;
  if (!jsxFactory?.jsx) {
    return () => {};
  }

  let renderPatch;
  // Steam's context-menu class is private to its Webpack module. The wrapper
  // creates it through the global JSX factory, so capture that one element and
  // patch its mutable class prototype before React renders the menu.
  const jsxPatch = afterPatch(jsxFactory, "jsx", (args, result) => {
    const menuClass = args[0];
    const prototype = menuClass?.prototype;
    if (
      renderPatch ||
      !prototype ||
      typeof prototype.GetTargetApps !== "function" ||
      typeof prototype.AddToFavorites !== "function" ||
      typeof prototype.GetCollectionManagementActions !== "function" ||
      typeof prototype.BuildManageSubmenu !== "function" ||
      typeof prototype.render !== "function"
    ) {
      return result;
    }

    debug.captured = true;
    renderPatch = afterPatch(
      prototype,
      "render",
      function (_renderArgs, renderedMenu) {
        return injectNativeLibraryShareItem(this, renderedMenu, debug);
      },
    );
    jsxPatch.unpatch();
    return result;
  });

  return () => {
    if (!jsxPatch.hasUnpatched) {
      jsxPatch.unpatch();
    }
    if (renderPatch && !renderPatch.hasUnpatched) {
      renderPatch.unpatch();
    }
  };
}

Millennium.exposeObj({
  steamShare: {
    getFriends,
    sendGameLink,
  },
});

/** The frontend bridges Store WebKit and adds the native Library menu entry. */
export default definePlugin(() => {
  globalThis[LIBRARY_INTEGRATION_KEY]?.stop?.();
  const debug = {
    windows: [],
    lastAppId: undefined,
  };
  const stop = installLibraryDetailsWindows(debug);
  globalThis[LIBRARY_INTEGRATION_KEY] = {
    stop,
    shareFromLibraryMenu: (context) => shareLibraryGame(context),
    debug,
  };

  return {
    icon: null,
    onDismount: stop,
  };
});
