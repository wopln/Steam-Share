# Steam Share

Steam Share is a TypeScript-only [Millennium](https://steambrew.app/) plugin that adds a native-looking **Share** action to Steam Store game pages. It opens a multi-friend picker, then sends the current game link to each selected friend after an explicit **Send** click. The link is also copied as a fallback.

## What it does

- Runs in Millennium's WebKit context, the context that owns Steam Store pages,
  with no native backend process.
- Includes Millennium's required minimal frontend entry; it does not add a
  separate Steam UI surface.
- Injects only on `store.steampowered.com/app/<app-id>` routes.
- Reuses Steam's `.queue_control_button` and `.btnv6_blue_hoverfade` markup so Steam continues to provide the button's spacing, typography, colors, hover treatment, and theme compatibility.
- Observes DOM and navigation changes, enabling the action on newly loaded game pages without restarting Steam.
- Uses an idempotent insertion check, preventing duplicate buttons during dynamic updates.
- Uses `navigator.clipboard` first and a CEF-friendly `document.execCommand("copy")` fallback.
- Uses Steam's internal Friends & Chat stores to list friends and submit the selected messages. This is experimental because Steam does not expose chat sending through Millennium's public API; Steam client updates can require a compatibility update.

## Architecture

`webkit/application` coordinates the page lifecycle. `routing` decides whether the current route is a game page. `ui` owns DOM presentation, `platform` wraps browser-specific clipboard access, and `domain`/`services` separate share actions from Steam DOM work.

The present `CopyLinkAction` is the default `ShareAction`. Future Discord, X, WhatsApp, Markdown, BBCode, App ID, localization, settings, or theme-aware actions can be added as actions without changing the routing or button lifecycle.

## Build

Requirements: a current Millennium installation and [Bun](https://bun.sh/).

```powershell
bun install
bun run build
```

Millennium's toolchain writes the production plugin artifacts to `.millennium/Dist`. Place this project directory, or a symbolic link to it, in Millennium's `plugins` directory, then enable **Steam Share** in Millennium and restart Steam once.

For iterative development, use `bun run dev` and reload the Steam WebKit page as supported by your Millennium development setup.

## Verification checklist

1. Visit two different Steam Store game pages without restarting Steam.
2. Confirm one Share action appears with Wishlist, Follow, and Ignore.
3. Click Share and paste into a text field; it should equal the current page URL.
4. Confirm `Link copied!` appears briefly above the action.
5. Navigate to a non-game Store page; the injected action should not remain.
