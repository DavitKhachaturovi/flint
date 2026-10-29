import type { MainBridge } from '../preload/main.js';
import type { HotkeysBridge } from '../preload/hotkeys.js';
import type { PopupBridge } from '../preload/popup.js';

declare global {
  interface Window {
    readonly flintPopup: PopupBridge;
    readonly flintMain: MainBridge;
    readonly flintHotkeys: HotkeysBridge;
  }
}
