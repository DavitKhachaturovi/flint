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

export interface SpacesWatcher {
  /** Watches the spaces' folders the workspace knows now (call after every change: it's cheap). */
  sync(): void;
  close(): void;
}

/**
 * SPACE-01 (D-190 Q20): each space's folder, watched as the Flint folder is (top-level `*.md`), and
 * `Spaces/` itself, so a space folder added, removed or renamed (made by hand, copied in, joined)
 * is noticed. `folders()` names the spaces' folders; `root` may not exist yet (no space so far).
 */
export function watchSpaces(
  root: string,
  folders: () => readonly string[],
  onChange: (path: string) => void,
  debounceMs = 150,
): SpacesWatcher {
  const watched = new Map<string, FolderWatcher>();
  let rootWatcher: FSWatcher | null = null;
  let rootTimer: NodeJS.Timeout | undefined;
  const watchRoot = (): void => {
    if (rootWatcher) return;
    try {
      rootWatcher = watch(root, { recursive: false }, (_event, name) => {
        clearTimeout(rootTimer);
        rootTimer = setTimeout(() => onChange(join(root, name ? name.toString() : '')), debounceMs);
      });
      rootWatcher.on('error', () => {
        rootWatcher?.close();
        rootWatcher = null;
      });
    } catch {
      // No Spaces folder yet: watched once a space is made (the next sync).
    }
  };
  return {
    sync() {
      watchRoot();
      const wanted = new Set(folders());
      for (const [folder, watcher] of watched)
        if (!wanted.has(folder)) {
          watcher.close();
          watched.delete(folder);
        }
      for (const folder of wanted) {
        if (watched.has(folder)) continue;
        try {
          watched.set(folder, watchListFolder(folder, onChange));
        } catch {
          // Gone meanwhile: the root watcher reports it.
        }
      }
    },
    close() {
      clearTimeout(rootTimer);
      rootWatcher?.close();
      for (const watcher of watched.values()) watcher.close();
      watched.clear();
    },
  };
}
