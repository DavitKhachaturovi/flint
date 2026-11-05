import { contextBridge } from 'electron';
import { CLOCK_ARGUMENT, installTestClock } from '../shared/test-clock.js';

/** D-107: the end-to-end tests' fixed clock, in this page's world too (test mode only). */
export function applyTestClock(): void {
  const argument = process.argv.find((each) => each.startsWith(CLOCK_ARGUMENT));
  if (!argument) return;
  const offset = Number(argument.slice(CLOCK_ARGUMENT.length));
  if (!Number.isFinite(offset)) return;
  contextBridge.executeInMainWorld({ func: installTestClock, args: [offset] });
}
