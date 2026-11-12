import { describe, expect, it } from 'vitest';
import {
  addEntry,
  binFolder,
  parseRegQuery,
  PATH_LIMIT,
  removeEntry,
  sameEntry,
} from './path-entry.js';

/** AGENT-02 (D-185 Q14): the PATH step's matching and guards, without touching the registry. */

const BIN = 'C:\\Users\\Alex\\AppData\\Local\\Programs\\flint\\resources\\bin';

describe('adding flint.exe’s folder to the user’s PATH', () => {
  it('appends once, at the end', () => {
    expect(addEntry('C:\\Tools;%USERPROFILE%\\bin', true, BIN)).toEqual({
      kind: 'write',
      value: `C:\\Tools;%USERPROFILE%\\bin;${BIN}`,
    });
    expect(addEntry(`C:\\Tools;${BIN.toUpperCase()}\\`, true, BIN)).toEqual({ kind: 'present' });
    expect(addEntry('C:\\Tools;', true, BIN)).toEqual({ kind: 'write', value: `C:\\Tools;${BIN}` });
  });

  it('creates the value when there is none', () => {
    expect(addEntry(null, false, BIN)).toEqual({ kind: 'write', value: BIN });
  });

  it('leaves a value alone that reads back empty or is too long', () => {
    expect(addEntry(null, true, BIN)).toEqual({ kind: 'unreadable' });
    expect(addEntry('', true, BIN)).toEqual({ kind: 'unreadable' });
    expect(addEntry('x'.repeat(PATH_LIMIT), true, BIN)).toEqual({ kind: 'too-long' });
  });
});

describe('removing it on uninstall', () => {
  it('takes exactly that entry, never part of another', () => {
    expect(removeEntry(`C:\\A;${BIN};C:\\B`, true, BIN)).toEqual({
      kind: 'write',
      value: 'C:\\A;C:\\B',
    });
    expect(removeEntry(`C:\\A;${BIN}\\more`, true, BIN)).toEqual({ kind: 'absent' });
    expect(
      removeEntry(
        'C:\\Windows\\system32;C:\\Windows\\system32\\wbem',
        true,
        'C:\\Windows\\system32',
      ),
    ).toEqual({ kind: 'write', value: 'C:\\Windows\\system32\\wbem' });
  });

  it('leaves an unreadable or too long value alone', () => {
    expect(removeEntry(null, true, BIN)).toEqual({ kind: 'unreadable' });
    expect(removeEntry(`${'x'.repeat(PATH_LIMIT)};${BIN}`, true, BIN)).toEqual({
      kind: 'too-long',
    });
    expect(removeEntry(null, false, BIN)).toEqual({ kind: 'absent' });
  });
});

describe('reading the registry and the exe’s folder', () => {
  it('reads reg query’s type and value, keeping %variables%', () => {
    const output =
      '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\Tools\r\n\r\n';
    expect(parseRegQuery(output, 'Path')).toEqual({
      type: 'REG_EXPAND_SZ',
      value: '%USERPROFILE%\\bin;C:\\Tools',
    });
    expect(
      parseRegQuery(
        '\r\nHKEY_CURRENT_USER\\Environment\r\n    TEMP    REG_SZ    C:\\T\r\n',
        'Path',
      ),
    ).toBeNull();
  });

  it('compares entries as Windows does, and only works as the installed exe', () => {
    expect(sameEntry('"C:\\Tools\\"', 'c:\\tools')).toBe(true);
    expect(sameEntry('', '')).toBe(false);
    expect(binFolder(`${BIN}\\flint.exe`)).toBe(BIN);
    expect(binFolder('C:\\Program Files\\nodejs\\node.exe')).toBeNull();
  });
});
