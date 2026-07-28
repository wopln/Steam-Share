import { Millennium, definePlugin } from "@steambrew/client";

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

Millennium.exposeObj({
  steamShare: {
    getFriends,
    sendGameLink,
  },
});

/**
 * Millennium's compiler requires a frontend entry even though Steam Share's
 * Store button is rendered in WebKit. This entry bridges it to Steam Chat.
 */
export default definePlugin(() => ({
  icon: null,
}));
