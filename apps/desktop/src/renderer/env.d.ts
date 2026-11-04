import type { MainBridge } from '../preload/main.js';
import type { PopupBridge } from '../preload/popup.js';

declare global {
  interface Window {
    readonly flintPopup: PopupBridge;
    readonly flintMain: MainBridge;
  }
}
