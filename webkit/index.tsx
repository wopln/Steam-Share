import { SteamShareController } from "./application/steam-share-controller";
import { CopyLinkAction } from "./services/copy-link-action";
import { FavoritesStore } from "./services/favorites-store";
import { RecentContactsStore } from "./services/recent-contacts-store";
import { ShareService } from "./services/share-service";
import { SteamChatBridge } from "./platform/steam-chat-bridge";
import { FriendPicker } from "./ui/friend-picker";
import { NativeShareButton } from "./ui/native-share-button";
import { ToastPresenter } from "./ui/toast";

const CONTROLLER_KEY = "__steamShareController__";

interface SteamShareWindow extends Window {
  [CONTROLLER_KEY]?: SteamShareController;
}

/** Millennium loads this module inside Steam's store WebKit browser view. */
export default function SteamShare(): void {
  const steamWindow = window as SteamShareWindow;
  steamWindow[CONTROLLER_KEY]?.stop();

  const controller = new SteamShareController(
    new ShareService(new CopyLinkAction()),
    new FriendPicker(
      new SteamChatBridge(),
      new RecentContactsStore(),
      new FavoritesStore(),
    ),
    new NativeShareButton(),
    new ToastPresenter(),
  );
  steamWindow[CONTROLLER_KEY] = controller;
  controller.start();
}
