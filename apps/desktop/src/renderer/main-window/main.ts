import type { ToastKind } from '../../shared/ipc.js';

/** Development harness for R-1 and R-3 until the real main window (M4). */

const log = document.querySelector<HTMLOListElement>('.log');

window.flintMain.onEvent(({ at, message }) => {
  if (!log) return;
  const item = document.createElement('li');
  item.textContent = `${new Date(at).toLocaleTimeString()}  ${message}`;
  log.prepend(item);
});

for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-toast]')) {
  button.addEventListener('click', () =>
    window.flintMain.sendTestToast(button.dataset.toast as ToastKind),
  );
}
