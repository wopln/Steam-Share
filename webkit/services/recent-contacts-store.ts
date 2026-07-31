import type { FriendShareResult, ShareFriend } from "../domain/share-friend";

const STORAGE_KEY = "steam-share:recent-contact-ids:v1";
const MAX_RECENT_CONTACTS = 3;

/**
 * Persists the recipient IDs of successful shares in the Store browser's
 * local storage. Friend details are resolved from Steam's live list each time
 * the picker opens, so names, status and avatars never become stale.
 */
export class RecentContactsStore {
  private cachedIds: readonly string[] | undefined;

  public resolve(friends: readonly ShareFriend[]): readonly ShareFriend[] {
    const friendsById = new Map(friends.map((friend) => [friend.steamId64, friend]));
    return this.readIds()
      .map((steamId64) => friendsById.get(steamId64))
      .filter((friend): friend is ShareFriend => friend !== undefined);
  }

  public recordSuccessfulRecipients(
    deliveries: FriendShareResult,
    friends: readonly ShareFriend[],
  ): void {
    const deliveredIds = new Set(
      deliveries.filter((delivery) => delivery.sent).map((delivery) => delivery.steamId64),
    );
    const newlyContactedIds = friends
      .map((friend) => friend.steamId64)
      .filter((steamId64) => deliveredIds.has(steamId64));

    if (newlyContactedIds.length === 0) {
      return;
    }

    const recentlyContacted = [
      ...newlyContactedIds,
      ...this.readIds().filter((steamId64) => !deliveredIds.has(steamId64)),
    ];
    this.writeIds(recentlyContacted);
  }

  private readIds(): readonly string[] {
    if (this.cachedIds !== undefined) {
      return this.cachedIds;
    }

    try {
      const storedValue = window.localStorage.getItem(STORAGE_KEY);
      this.cachedIds = this.normaliseIds(storedValue === null ? [] : JSON.parse(storedValue));
    } catch {
      // Storage can be unavailable in some Steam browser modes. The current
      // session still retains recent contacts through the in-memory cache.
      this.cachedIds = [];
    }

    return this.cachedIds;
  }

  private writeIds(ids: readonly string[]): void {
    this.cachedIds = this.normaliseIds(ids);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cachedIds));
    } catch {
      // Keep the in-memory result if persistent browser storage is unavailable.
    }
  }

  private normaliseIds(value: unknown): readonly string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const uniqueIds = new Set<string>();
    for (const valueItem of value) {
      if (typeof valueItem === "string" && valueItem.length > 0) {
        uniqueIds.add(valueItem);
      }
      if (uniqueIds.size === MAX_RECENT_CONTACTS) {
        break;
      }
    }
    return [...uniqueIds];
  }
}
