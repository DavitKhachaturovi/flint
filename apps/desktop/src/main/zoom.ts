import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './storage/atomic.js';

/**
 * Interface size (UI-12, D-81): the main window's zoom, in Chrome's steps, remembered per display,
 * so a laptop panel at 200 % and a 1080p monitor at 100 % each keep their own. Machine UI state in
 * app data (`zoom.json`), never in the Flint folder.
 */

export const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export type ZoomStep = 'in' | 'out' | 'reset';

/** The next zoom from `current`: one step in or out (from the nearest step), or back to 100 %. */
export function stepZoom(current: number, how: ZoomStep): number {
  if (how === 'reset') return 1;
  if (how === 'in')
    return ZOOM_STEPS.find((step) => step > current + 0.001) ?? ZOOM_STEPS.at(-1) ?? 1;
  return [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001) ?? ZOOM_STEPS[0];
}

/** The zoom a key asks for with Ctrl held: Ctrl+= (Ctrl++), Ctrl+−, Ctrl+0, the keypad's too. */
export function zoomKey(key: string, code: string): ZoomStep | null {
  if (key === '=' || key === '+' || code === 'NumpadAdd') return 'in';
  if (key === '-' || key === '_' || code === 'NumpadSubtract') return 'out';
  if (key === '0' || code === 'Numpad0') return 'reset';
  return null;
}

export interface DisplayLike {
  readonly id: number;
  readonly label?: string;
  readonly size: { readonly width: number; readonly height: number };
}

/** A display, as stable across restarts as Windows lets it be: its name and size, else its ID. */
export function displayKey(display: DisplayLike): string {
  const name = display.label?.trim() || `display ${display.id}`;
  return `${name} ${display.size.width}x${display.size.height}`;
}

/** A tolerant reader: anything that isn't a sensible zoom is left out. */
export function readZooms(stored: unknown): Record<string, number> {
  const zooms: Record<string, number> = {};
  if (typeof stored !== 'object' || stored === null) return zooms;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>))
    if (typeof value === 'number' && value >= ZOOM_STEPS[0] && value <= (ZOOM_STEPS.at(-1) ?? 2))
      zooms[key] = value;
  return zooms;
}

export class ZoomFile {
  private zooms: Record<string, number> = {};
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      this.zooms = readZooms(JSON.parse(await readFile(this.path, 'utf8')));
    } catch {
      this.zooms = {};
    }
  }

  get(display: string): number {
    return this.zooms[display] ?? 1;
  }

  async set(display: string, zoom: number): Promise<void> {
    if (zoom === 1) delete this.zooms[display];
    else this.zooms[display] = zoom;
    await writeFileAtomic(this.path, `${JSON.stringify(this.zooms, null, 2)}\n`, {
      tempDirectory: join(dirname(this.path), 'tmp'),
    });
  }
}

/**
 * NAV-07, D-83: the displays where the context panel is hidden (Ctrl+\), in `panel.json` next to
 * the zoom: the panel shows by default wherever it fits.
 */
export class PanelFile {
  private hiddenOn = new Set<string>();
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      this.hiddenOn = new Set(
        Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [],
      );
    } catch {
      this.hiddenOn = new Set();
    }
  }

  hidden(display: string): boolean {
    return this.hiddenOn.has(display);
  }

  async set(display: string, hidden: boolean): Promise<void> {
    if (hidden) this.hiddenOn.add(display);
    else this.hiddenOn.delete(display);
    await writeFileAtomic(this.path, `${JSON.stringify([...this.hiddenOn], null, 2)}\n`, {
      tempDirectory: join(dirname(this.path), 'tmp'),
    });
  }
}
