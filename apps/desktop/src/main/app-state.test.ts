import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, readSettings, SettingsFile } from './settings.js';
import {
  monitorSetupKey,
  rememberBounds,
  restoreBounds,
  type DisplayInfo,
} from './window-state.js';

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'flint-settings-'));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('settings (APP-11)', () => {
  it('defaults: Flint folder in the user profile, outside OneDrive (D-24); no Alt hotkey (Q-03)', () => {
    expect(defaultSettings()).toMatchObject({
      flintFolder: join(homedir(), 'Flint'),
      captureHotkey: 'Control+Shift+Space',
      startWithWindows: true,
      hideNotificationText: false,
    });
    expect(readSettings({ hideNotificationText: true }).hideNotificationText).toBe(true);
  });

  it('falls back per key on invalid values', () => {
    expect(
      readSettings({
        startWithWindows: 'yes',
        sound: false,
        flintFolder: '',
        hideNotificationText: 1,
      }),
    ).toMatchObject({
      startWithWindows: true,
      sound: false,
      hideNotificationText: false,
      flintFolder: join(homedir(), 'Flint'),
    });
  });

  it('survives a broken file and keeps keys it does not know when saving', async () => {
    const path = join(folder, 'settings.json');
    await writeFile(path, '{ broken');
    const file = new SettingsFile(path);
    expect(await file.load()).toEqual(defaultSettings());
    await writeFile(path, JSON.stringify({ futureSetting: 42, sound: false }));
    await file.load();
    await file.update({ notifications: false });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      futureSetting: 42,
      sound: false,
      notifications: false,
      version: 1,
    });
  });
});

const laptop: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1032 },
  scaleFactor: 1.5,
};
const monitor: DisplayInfo = {
  id: 2,
  bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
  workArea: { x: 1920, y: 0, width: 2560, height: 1392 },
  scaleFactor: 1,
};
const fallback = { x: 0, y: 0, width: 900, height: 640 };

describe('window state (APP-05)', () => {
  it('keys monitor setups by their displays, in any order', () => {
    expect(monitorSetupKey([laptop, monitor])).toBe(monitorSetupKey([monitor, laptop]));
    expect(monitorSetupKey([laptop])).not.toBe(monitorSetupKey([laptop, monitor]));
  });

  it('restores a position that is still on a screen', () => {
    const saved = { x: 2200, y: 100, width: 900, height: 640 };
    expect(restoreBounds(saved, [laptop, monitor], laptop, fallback)).toEqual(saved);
  });

  it('moves a window whose screen is gone onto the active display', () => {
    const saved = { x: 2200, y: 100, width: 900, height: 640 };
    expect(restoreBounds(saved, [laptop], laptop, fallback)).toEqual({
      x: 510,
      y: 196,
      width: 900,
      height: 640,
    });
  });

  it('shrinks to fit and uses the default size when nothing is saved', () => {
    const small: DisplayInfo = { ...laptop, workArea: { x: 0, y: 0, width: 800, height: 600 } };
    expect(restoreBounds(undefined, [small], small, fallback)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });

  it('remembers bounds per window and per setup', () => {
    const states = rememberBounds(rememberBounds({}, 'main', 'a', fallback), 'main', 'b', {
      ...fallback,
      x: 5,
    });
    expect(Object.keys(states.main ?? {})).toEqual(['a', 'b']);
  });
});
