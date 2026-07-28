export interface ShareFriend {
  readonly steamId64: string;
  readonly displayName: string;
  readonly status: string;
  readonly gameName: string;
  readonly avatarUrl: string;
}

export interface FriendDelivery {
  readonly steamId64: string;
  readonly sent: boolean;
  readonly error?: string;
}

export type FriendShareResult = readonly FriendDelivery[];
