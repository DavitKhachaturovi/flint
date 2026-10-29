import { acceleratorFor, displayAccelerator, usesAlt } from '../../shared/accelerator.js';
import type { HotkeyName, HotkeysView, RebindOutcome } from '../../shared/ipc.js';

/**
 * The Hotkeys window (APP-08, Proposed until Settings, M8): click a hotkey, press the new keys.
 * Flint tries the combination at once; if another app owns it, the old one stays and it says so.
 */

const message = document.querySelector<HTMLElement>('.message');
const DOES: Record<HotkeyName, string> = {
  capture: 'opens the capture popup',
  selection: 'captures the selection',
};

let view: HotkeysView | null = null;
let recording: { name: HotkeyName; button: HTMLButtonElement } | null = null;

function say(text: string): void {
  if (message) message.textContent = text;
}

function render(): void {
  if (!view) return;
  for (const row of document.querySelectorAll<HTMLElement>('.row')) {
    const name = row.dataset.name as HotkeyName;
    const button = row.querySelector<HTMLButtonElement>('.record');
    const state = view[name];
    if (!button || recording?.button === button) continue;
    button.textContent = displayAccelerator(state.accelerator);
    button.classList.toggle('unavailable', !state.registered);
    button.title = state.registered ? '' : 'Another app uses this combination';
  }
}

async function refresh(): Promise<void> {
  view = await window.flintHotkeys.state();
  render();
  const broken = (['capture', 'selection'] as const).find((name) => !view?.[name].registered);
  if (broken && view) {
    say(
      `${displayAccelerator(view[broken].accelerator)} is used by another app, so it doesn't work. Choose another.`,
    );
  }
}

function stop(): void {
  if (!recording) return;
  recording.button.classList.remove('recording');
  recording = null;
  window.flintHotkeys.recording(false);
  render();
}

function explain(outcome: RebindOutcome, name: HotkeyName, accelerator: string): string {
  const keys = displayAccelerator(accelerator);
  switch (outcome) {
    case 'saved':
      return `Saved: ${keys} ${DOES[name]}.${usesAlt(accelerator) ? ' Note: Alt is often a push-to-talk key (Discord).' : ''}`;
    case 'in-use':
      return `${keys} is already used by another app. Try another combination.`;
    case 'needs-modifier':
      return 'Use Ctrl, Alt or Win together with a key.';
    case 'same-as-other':
      return 'That is already the other Flint hotkey.';
    case 'invalid':
      return 'Flint cannot use that key. Try another.';
  }
}

for (const row of document.querySelectorAll<HTMLElement>('.row')) {
  const name = row.dataset.name as HotkeyName;
  const button = row.querySelector<HTMLButtonElement>('.record');
  if (!button) continue;
  button.addEventListener('click', () => {
    stop();
    recording = { name, button };
    button.classList.add('recording');
    button.textContent = 'Press the new keys…';
    say('Esc cancels.');
    window.flintHotkeys.recording(true);
  });
}

window.addEventListener('keydown', (event) => {
  if (!recording) return;
  event.preventDefault();
  if (event.key === 'Escape') {
    stop();
    say('');
    return;
  }
  const accelerator = acceleratorFor(event);
  if (!accelerator) return; // only modifiers so far
  const { name } = recording;
  void window.flintHotkeys.rebind(name, accelerator).then(async (outcome) => {
    stop();
    await refresh();
    say(explain(outcome, name, accelerator));
  });
});

window.addEventListener('blur', () => {
  if (recording) {
    stop();
    say('');
  }
});

window.addEventListener('focus', () => void refresh());
void refresh();
