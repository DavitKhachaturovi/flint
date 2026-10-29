import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IDENTITIES } from './identity.js';
import { findActivation, parseActivation, reminderToastXml } from './toast.js';

const desktop = join(import.meta.dirname, '../..');

describe('app identity (D-33)', () => {
  it('the installed AppUserModelID is the installer appId, and the uninstaller cleans its scheme', () => {
    const builder = readFileSync(join(desktop, 'electron-builder.yml'), 'utf8');
    expect(/^appId: (.+)$/m.exec(builder)?.[1]).toBe(IDENTITIES.installed.appId);
    const uninstall = readFileSync(join(desktop, 'resources', 'installer.nsh'), 'utf8');
    expect(uninstall).toContain(`Software\\Classes\\${IDENTITIES.installed.protocol}`);
  });

  it('development and benchmark builds never share an identity with the installed app', () => {
    const { installed, development, bench } = IDENTITIES;
    for (const other of [development, bench]) {
      expect(other.appId).not.toBe(installed.appId);
      expect(other.protocol).not.toBe(installed.protocol);
      expect(other.name).not.toBe(installed.name);
    }
  });
});

describe('reminder toasts (REM-05, R-3)', () => {
  const toast = {
    id: 'k3f9',
    title: 'Fix <null> ref & "quotes"',
    label: 'Reminder · 15:00',
    kind: 'reminder',
  } as const;

  it('buttons launch the build’s own scheme, with the text escaped', () => {
    const xml = reminderToastXml(toast, 'flint-dev');
    expect(xml).toContain('scenario="reminder"');
    expect(xml).toContain('arguments="flint-dev://reminder/done?id=k3f9"');
    expect(xml).toContain('arguments="flint-dev://reminder/snooze?id=k3f9"');
    expect(xml).toContain('launch="flint-dev://reminder/open?id=k3f9"');
    expect(xml).toContain('Fix &#60;null&#62; ref &#38; &#34;quotes&#34;');
    expect(xml).not.toContain('flint://');
  });

  it('a default toast has no scenario', () => {
    expect(reminderToastXml({ ...toast, kind: 'default' }, 'flint')).not.toContain('scenario');
  });

  it('parses only its own scheme', () => {
    expect(parseActivation('flint://reminder/done?id=k3f9', 'flint')).toEqual({
      action: 'done',
      id: 'k3f9',
    });
    expect(parseActivation('flint://reminder/done?id=k3f9', 'flint-dev')).toBeNull();
    expect(parseActivation('flint-dev://reminder/open?id=a%20b', 'flint-dev')).toEqual({
      action: 'open',
      id: 'a b',
    });
    expect(parseActivation('flint://reminder/delete?id=k3f9', 'flint')).toBeNull();
    expect(parseActivation('flint://other/done?id=k3f9', 'flint')).toBeNull();
    expect(parseActivation('flint://reminder/done', 'flint')).toBeNull();
    expect(
      findActivation(['Flint.exe', '--hidden', 'flint://reminder/snooze?id=x1'], 'flint'),
    ).toEqual({ action: 'snooze', id: 'x1' });
  });
});
