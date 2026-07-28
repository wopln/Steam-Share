import type { ShareAction, ShareContext } from "../domain/share-action";

/**
 * A small action registry makes a future menu/settings page additive: Discord,
 * X, WhatsApp, Markdown, BBCode, and App ID actions can be registered here
 * without coupling their transport code to the Steam page integration.
 */
export class ShareService {
  public constructor(private readonly defaultAction: ShareAction) {}

  public get label(): string {
    return this.defaultAction.label;
  }

  public share(context: ShareContext): Promise<void> {
    return this.defaultAction.execute(context);
  }
}
