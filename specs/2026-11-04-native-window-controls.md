# Native window control clearance

Date: 2026-11-04
Status: implemented and independently reviewed; release verification pending

Windowed macOS at reduced renderer zoom can place the sidebar toggle under the
traffic lights. The current 88 CSS pixel reservation shrinks with zoom; the
native buttons retain their OS size. The top row also becomes shorter than the
native control area.

Enable Electron's macOS Window Controls Overlay and consume its existing CSS
safe-area variables. Use `titlebar-area-x` for left clearance and the greater of
52 CSS pixels or `titlebar-area-height` for the row height. Keep the existing
10 pixel fullscreen inset, sidebar behavior, native buttons, and zoom controls.
No new IPC, zoom listeners, or stored preferences are needed.

Acceptance: actual Electron window checks at 50%, 67%, 80%, 100%, and 125%,
with open, collapsed, and peeking sidebar, minimum sidebar/window width, tabs,
and both history controls. Native controls and document navigation must remain
clear of each other. Enter/exit fullscreen and verify the compact inset returns.
Check sidebar clicks, native window controls, and draggable titlebar space.

Independent design review by GPT-6.1 Sol, High reasoning, recommended using
Electron's native geometry rather than increasing a fixed margin. Native
measurement confirmed zoom-adjusted safe area x/height and reproduced the
original overlap at 80%; the vertical row minimum is therefore included.

Run the macOS native regression against the built app with its real IPC. It
uses a fresh temporary profile/workspace and needs no Vite server.

```sh
npm run build
node_modules/.bin/electron tests/manual/window-chrome.cjs
```

Add `--screenshots` to save native window screenshots in the reported temporary
folder when Screen Recording permission is already granted.

Ship a signed/notarized 0.8.1 through the normal release process. Verify the
public app and install that official release in Applications, preserving the
user profile. Unregister and remove task-created app copies afterward so only
the official installed app remains available in macOS launch menus.

Validation passed: 1,241 tests across 123 files, full typecheck, CSS lint,
production build, and the production audit high gate. The built-app native
regression passed all five zoom levels in open, collapsed, and peeking modes,
with actual minimum sidebar width, three tabs, both history controls, full
button bounds and widths, fullscreen round trip, and native minimize/restore.
Screenshots confirmed native and app controls remain aligned and clear.
