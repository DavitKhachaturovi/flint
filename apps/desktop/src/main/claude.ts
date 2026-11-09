import { stat } from 'node:fs/promises';
import { planHandoff } from '../shared/claude.js';
import type { ClaudeState, GiveToClaudeOutcome, GiveToClaudeRequest } from '../shared/ipc.js';
import { CLAUDE_RECENT_FOLDERS, isAbsoluteFolder, type Settings } from './settings.js';

/**
 * Give to Claude (TASK-18, D-151), main's side: the folders remembered on this machine, and the one
 * thing Flint does, handing a `claude://code/new` link it builds itself to Windows. The renderer
 * sends a prompt and a folder, never a link, so nothing else can be opened this way.
 */

/** A prompt longer than this isn't a task's (a runaway paste): refused. */
const PROMPT_MAX = 2_000_000;

export async function folderExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** What the card and Settings show: the folders, which of them are gone, whether Claude is there. */
export async function claudeState(
  settings: Settings,
  flintFolder: string,
  installed: boolean,
): Promise<ClaudeState> {
  const paths = [
    ...new Set([...Object.values(settings.claudeFolders), ...settings.claudeRecentFolders]),
  ];
  const exists = await Promise.all(paths.map(folderExists));
  return {
    installed,
    flintFolder,
    folders: settings.claudeFolders,
    recent: settings.claudeRecentFolders,
    missing: paths.filter((_, index) => !exists[index]),
  };
}

/** `folder` first among the recent folders (once, whatever its letter case), five at most. */
export function withRecent(recent: readonly string[], folder: string): string[] {
  const key = folder.toLowerCase();
  return [folder, ...recent.filter((path) => path.toLowerCase() !== key)].slice(
    0,
    CLAUDE_RECENT_FOLDERS,
  );
}

/** A list's folder set (a path) or forgotten (null). */
export function withFolder(
  folders: Readonly<Record<string, string>>,
  list: string,
  folder: string | null,
): Record<string, string> {
  const next = { ...folders };
  if (folder === null) delete next[list];
  else next[list] = folder;
  return next;
}

export function readGiveRequest(value: unknown): GiveToClaudeRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const { prompt, folder, list, makeDefault } = value as Record<string, unknown>;
  if (typeof prompt !== 'string' || prompt === '' || prompt.length > PROMPT_MAX) return null;
  if (!isAbsoluteFolder(folder)) return null;
  if (list !== null && (typeof list !== 'string' || list === '')) return null;
  return { prompt, folder, list, makeDefault: makeDefault === true };
}

/** What giving needs from the machine: injected, so tests never open or copy anything. */
export interface GiveEffects {
  /** Whether Windows has a `claude://` handler. */
  installed(): boolean;
  /** `shell.openExternal`: rejects when Windows refuses the link. */
  open(url: string): Promise<void>;
  copy(text: string): void | Promise<void>;
}

/**
 * Gives a task to Claude: the link (or, for a prompt too long for one, the clipboard and a link
 * with a note, D-151), then the folder first among the recent ones and, asked for, the list's.
 * The clipboard is written only once the link has opened, so a refused link leaves it as it was.
 */
export async function giveToClaude(
  request: GiveToClaudeRequest,
  settings: Settings,
  effects: GiveEffects,
): Promise<{ outcome: GiveToClaudeOutcome; changes: Partial<Settings> | null }> {
  if (!(await folderExists(request.folder))) return { outcome: 'no-folder', changes: null };
  if (!effects.installed()) return { outcome: 'not-installed', changes: null };
  const handoff = planHandoff(request.prompt, request.folder);
  try {
    await effects.open(handoff.url);
  } catch {
    return { outcome: 'not-installed', changes: null };
  }
  if (handoff.via === 'clipboard') await effects.copy(request.prompt);
  const changes: Partial<Settings> = {
    claudeRecentFolders: withRecent(settings.claudeRecentFolders, request.folder),
    ...(request.makeDefault && request.list !== null
      ? { claudeFolders: withFolder(settings.claudeFolders, request.list, request.folder) }
      : {}),
  };
  return { outcome: handoff.via === 'clipboard' ? 'copied' : 'opened', changes };
}
