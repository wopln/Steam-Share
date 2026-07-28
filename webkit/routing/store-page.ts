import type { ShareContext } from "../domain/share-action";

const APP_PATH = /^\/app\/(\d+)(?:\/|$)/i;

export function getSteamStoreGameContext(location: Location): ShareContext | undefined {
  if (location.hostname !== "store.steampowered.com") {
    return undefined;
  }

  const appId = APP_PATH.exec(location.pathname)?.[1];
  if (!appId) {
    return undefined;
  }

  return {
    appId,
    title: document.title.replace(/\s+on\s+Steam\s*$/i, ""),
    url: location.href,
  };
}
