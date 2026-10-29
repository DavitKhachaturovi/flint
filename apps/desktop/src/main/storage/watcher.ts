import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

/**
 * Watches the Flint folder (DATA-06): top-level `*.md` files only (D-23), with bursts debounced per
 * file. It reports names; telling Flint's own writes apart is done by content (`ListFile.reload`),
 * which is reliable with antivirus, OneDrive and editors that save in several steps.
 */
export interface FolderWatcher {
  close(): void;
}

export function watchListFolder(
  folder: string,
  onChange: (path: string) => void,
  debounceMs = 75,
): FolderWatcher {
  const timers = new Map<string, NodeJS.Timeout>();
  const watcher: FSWatcher = watch(folder, { recursive: false }, (_event, name) => {
    if (!name || !name.toLowerCase().endsWith('.md')) return;
    const path = join(folder, name.toString());
    clearTimeout(timers.get(path));
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path);
        onChange(path);
      }, debounceMs),
    );
  });
  return {
    close() {
      for (const timer of timers.values()) clearTimeout(timer);
      watcher.close();
    },
  };
}
