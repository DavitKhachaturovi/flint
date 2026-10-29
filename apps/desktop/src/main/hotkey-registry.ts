import { globalShortcut } from 'electron';
import { hotkeyProblem, type HotkeyProblem } from '../shared/accelerator.js';
import { acceleratorKeys } from './hotkeys.js';

/**
 * The two global hotkeys (CAP-01, CAP-07) and rebinding them with conflict detection (APP-08):
 * Windows refuses a combination another app has registered, and Flint then keeps the old one and
 * says so. App-internal shortcuts of other apps (e.g. VS Code's) can't be detected this way.
 */

export type HotkeyName = 'capture' | 'selection';

export type RebindResult =
  | { readonly kind: 'saved' }
  | { readonly kind: 'in-use' }
  | { readonly kind: 'invalid' }
  | { readonly kind: HotkeyProblem };

export interface HotkeyState {
  readonly accelerator: string;
  /** Whether Windows gave Flint the combination (false: another app owns it). */
  readonly registered: boolean;
}

export class HotkeyRegistry {
  private readonly handlers: Record<HotkeyName, () => void>;
  private readonly states: Record<HotkeyName, { accelerator: string; registered: boolean }>;
  private paused = false;

  constructor(accelerators: Record<HotkeyName, string>, handlers: Record<HotkeyName, () => void>) {
    this.handlers = handlers;
    this.states = {
      capture: { accelerator: accelerators.capture, registered: false },
      selection: { accelerator: accelerators.selection, registered: false },
    };
    for (const name of ['capture', 'selection'] as const) this.register(name);
  }

  private register(name: HotkeyName): boolean {
    const state = this.states[name];
    state.registered =
      acceleratorKeys(state.accelerator) !== null &&
      globalShortcut.register(state.accelerator, this.handlers[name]);
    return state.registered;
  }

  private unregister(name: HotkeyName): void {
    const state = this.states[name];
    if (state.registered) globalShortcut.unregister(state.accelerator);
    state.registered = false;
  }

  get(name: HotkeyName): HotkeyState {
    return { ...this.states[name] };
  }

  /** Tries the new combination; on any problem the old one stays (APP-08). */
  rebind(name: HotkeyName, accelerator: string): RebindResult {
    if (acceleratorKeys(accelerator) === null) return { kind: 'invalid' };
    const other = this.states[name === 'capture' ? 'selection' : 'capture'].accelerator;
    const problem = hotkeyProblem(accelerator, other);
    if (problem) return { kind: problem };
    const previous = this.states[name].accelerator;
    this.unregister(name);
    this.states[name].accelerator = accelerator;
    // Registering is the only way to learn whether another app owns it, also while paused.
    if (this.register(name)) {
      if (this.paused) this.unregister(name);
      return { kind: 'saved' };
    }
    this.states[name].accelerator = previous;
    if (!this.paused) this.register(name);
    return { kind: 'in-use' };
  }

  /** While a new hotkey is being recorded, the current ones must not fire. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const name of ['capture', 'selection'] as const) this.unregister(name);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const name of ['capture', 'selection'] as const) this.register(name);
  }
}
