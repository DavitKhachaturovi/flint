/**
 * D-190 Q11 (docs/04 §9): the file names a space's files may give, as they come from other
 * people's Flint and are written into the space's folder. On top of the rules for a list's name
 * (`isValidListName`: no folders, `..`, reserved names, trailing dots or spaces):
 * - nothing starting with a dot, no leading or trailing spaces;
 * - no 8.3 short-name aliases (`GROCER~1.md` is another file's second name on most Windows drives:
 *   writing it would overwrite that file);
 * - no other device names (`CONIN$`, `CONOUT$`, `COM0`, `LPT0`, a reserved name before spaces);
 * - no bidirectional or zero-width characters (a name that reads as something else), and none of
 *   the look-alikes of `/`, `\`, `:` and `.` that some programs turn into the real ones.
 * Attachments also never have a type Flint never attaches (D-84: programs, scripts, shortcuts) or
 * one Explorer reads just by showing the folder (the Q11 review: `.library-ms`, `.searchConnector-ms`,
 * `.url` and the like can send the Windows sign-in to another server without a click), and are
 * never `desktop.ini`.
 */
import { isValidListName } from '../shorthand/lists.js';

const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d|conin\$|conout\$|clock\$)[ ]*(\..*)?$/i;
/** Zero-width and bidirectional controls: a name that reads as something else. */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;
/** Look-alikes of `/`, `\\`, `:` and `.` (fullwidth, division slash, modifier colon, yen sign…). */
const LOOK_ALIKES = /[\uff0f\uff3c\u2215\u2044\u29f8\uff1a\ua789\uff0e\u2024\u00a5]/;

/** Programs, scripts and shortcuts (D-84) and what Explorer reads by showing a folder. */
export const NEVER_FROM_OTHERS: ReadonlySet<string> = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.ps1',
  '.psm1',
  '.psd1',
  '.msi',
  '.msp',
  '.scr',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.lnk',
  '.url',
  '.reg',
  '.hta',
  '.cpl',
  '.msc',
  '.jar',
  '.pif',
  '.application',
  '.appref-ms',
  '.scf',
  '.inf',
  '.sys',
  '.dll',
  '.sh',
  '.py',
  '.library-ms',
  '.search-ms',
  '.searchconnector-ms',
  '.website',
  '.settingcontent-ms',
]);

const base = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

const extension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/** Whether a name from someone else's Flint is safe to write as a file in a space's folder. */
export function isSafeFileName(name: string): boolean {
  const stem = base(name);
  return (
    isValidListName(name) &&
    !name.startsWith('.') &&
    name.trim() === name &&
    !(stem.length <= 8 && /~\d/.test(stem)) &&
    !DEVICE.test(name) &&
    !INVISIBLE.test(name) &&
    !LOOK_ALIKES.test(name)
  );
}

/** Whether an attachment's file name from someone else's Flint is safe to write and to show. */
export function isSafeAttachmentName(name: string): boolean {
  return (
    isSafeFileName(name) &&
    !NEVER_FROM_OTHERS.has(extension(name)) &&
    name.toLowerCase() !== 'desktop.ini'
  );
}

/**
 * The keys under which Windows may see two names as one file: NTFS compares by upper case (the
 * Greek final sigma lower-cases differently), so both forms count, after Unicode composition.
 */
export function windowsKeys(name: string): readonly string[] {
  const composed = name.normalize('NFC');
  return [composed.toUpperCase(), composed.toLowerCase()];
}

/** A tracker of names already taken, by `windowsKeys`. */
export function nameTaken(): (name: string) => boolean {
  const taken = new Set<string>();
  return (name) => {
    const keys = windowsKeys(name);
    if (keys.some((key) => taken.has(key))) return true;
    for (const key of keys) taken.add(key);
    return false;
  };
}

/** A member's name as another member's Flint gives it: shown in the app, so plain text only. */
export function isSafeLabel(text: string): boolean {
  const control = [...text].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
  return text.length <= 320 && !control && !INVISIBLE.test(text);
}
