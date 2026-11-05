import { contextBridge } from 'electron';
import { main } from './main-bridge.js';
import { applyTestClock } from './test-clock.js';

export type { MainBridge } from './main-bridge.js';

applyTestClock();
contextBridge.exposeInMainWorld('flintMain', main);
