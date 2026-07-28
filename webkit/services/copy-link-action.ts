import type { ShareAction, ShareContext } from "../domain/share-action";
import { copyText } from "../platform/clipboard";

/** The default action today; future share destinations implement ShareAction. */
export class CopyLinkAction implements ShareAction {
  public readonly id = "copy-link";
  public readonly label = "Share";

  public async execute(context: ShareContext): Promise<void> {
    await copyText(context.url);
  }
}
