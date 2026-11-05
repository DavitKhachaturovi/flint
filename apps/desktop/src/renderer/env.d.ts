import type { MainBridge } from '../preload/main.js';
import type { PopupBridge } from '../preload/popup.js';
import type { MiniBridge } from '../preload/mini.js';

declare global {
  interface Window {
    readonly flintPopup: PopupBridge;
    readonly flintMain: MainBridge;
    /** MINI-01, D-109: only in mini mode's window. */
    readonly flintMini: MiniBridge;
  }
}
