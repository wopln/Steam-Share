import { callable } from "@steambrew/webkit";
import type { FriendShareResult, ShareFriend } from "../domain/share-friend";

const getFriends = callable<[], string>("frontend:steamShare.getFriends");
const sendGameLink = callable<
  [string],
  string
>("frontend:steamShare.sendGameLink");

function unwrapMillenniumString(payload: unknown): string {
  if (typeof payload !== "string") {
    throw new Error("Steam returned an invalid bridge response.");
  }

  // In current Millennium builds, callable results are delivered as a JSON
  // representation of a DevTools RemoteObject: { type: "string", value: "…" }.
  // Older builds may deliver the string itself, so support both shapes.
  try {
    const envelope: unknown = JSON.parse(payload);
    if (
      envelope !== null &&
      typeof envelope === "object" &&
      "type" in envelope &&
      "value" in envelope &&
      envelope.type === "string" &&
      typeof envelope.value === "string"
    ) {
      return envelope.value;
    }
  } catch {
    // A direct, non-JSON string is already the value we need.
  }

  return payload;
}

/**
 * The Store page cannot access Steam's Friends data directly. Millennium's
 * frontend callable bridge invokes the current Steam Friends & Chat session.
 */
export class SteamChatBridge {
  public async loadFriends(): Promise<readonly ShareFriend[]> {
    const payload = unwrapMillenniumString(await getFriends());
    let friends: unknown;
    try {
      friends = JSON.parse(payload);
    } catch {
      throw new Error("Steam returned an invalid friend list.");
    }

    if (!Array.isArray(friends)) {
      throw new Error("Steam returned an invalid friend list.");
    }

    // Steam's private Friends UI can omit optional fields on individual
    // records. Normalize the bridge response here so one incomplete friend
    // can never prevent the whole picker (or its search input) from loading.
    const normalizedFriends = friends
      .filter((friend): friend is ShareFriend => Boolean(friend))
      .map((friend) => ({
        steamId64: String(friend.steamId64 ?? ""),
        displayName: String(friend.displayName ?? "Steam Friend"),
        status: String(friend.status ?? "Offline"),
        gameName: String(friend.gameName ?? ""),
        avatarUrl: String(friend.avatarUrl ?? ""),
      }))
      .filter((friend) => friend.steamId64.length > 0);

    return normalizedFriends.sort((first, second) => {
      const firstOffline = first.status.toLowerCase() === "offline";
      const secondOffline = second.status.toLowerCase() === "offline";
      if (firstOffline !== secondOffline) {
        return Number(firstOffline) - Number(secondOffline);
      }
      return first.displayName.localeCompare(second.displayName);
    });
  }

  public send(
    friendIds: readonly string[],
    message: string,
  ): Promise<FriendShareResult> {
    return sendGameLink(JSON.stringify({ friendIds: [...friendIds], message })).then(
      (rawPayload) => {
        try {
          const result: unknown = JSON.parse(unwrapMillenniumString(rawPayload));
          if (!Array.isArray(result)) {
            throw new Error();
          }
          return result as FriendShareResult;
        } catch {
          throw new Error("Steam returned an invalid share result.");
        }
      },
    );
  }
}
