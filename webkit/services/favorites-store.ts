const STORAGE_KEY = "steam-share:favorite-friend-ids:v1";

/** Stores the logged-in user's favorite Steam friend IDs in browser storage. */
export class FavoritesStore {
  private cachedIds: ReadonlySet<string> | undefined;

  public has(steamId64: string): boolean {
    return this.readIds().has(steamId64);
  }

  public add(steamId64: string): void {
    const ids = new Set(this.readIds());
    ids.add(steamId64);
    this.writeIds(ids);
  }

  public remove(steamId64: string): void {
    const ids = new Set(this.readIds());
    ids.delete(steamId64);
    this.writeIds(ids);
  }

  private readIds(): ReadonlySet<string> {
    if (this.cachedIds !== undefined) {
      return this.cachedIds;
    }

    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      this.cachedIds = this.normaliseIds(value === null ? [] : JSON.parse(value));
    } catch {
      this.cachedIds = new Set();
    }

    return this.cachedIds;
  }

  private writeIds(ids: ReadonlySet<string>): void {
    this.cachedIds = new Set(ids);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.cachedIds]));
    } catch {
      // The current Steam session retains favorites if browser storage is unavailable.
    }
  }

  private normaliseIds(value: unknown): ReadonlySet<string> {
    if (!Array.isArray(value)) {
      return new Set();
    }

    return new Set(value.filter((item): item is string => typeof item === "string"));
  }
}
