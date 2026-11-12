import type { AgentsSettingsView, ConnectApp } from '../../shared/agents.js';

/**
 * AGENT-05, AGENT-07 (D-185, mockup 17): what Settings → AI agents says, worked out from the view
 * main sends: the status under the switch, the apps connected, the skill's line, the time of a
 * change. Pure, so it is unit-tested.
 */

/** The status line's look: its dot and colour (mockup 17). */
export type StatusTone = 'on' | 'ro' | 'off' | 'paused';

export interface AgentsStatus {
  readonly tone: StatusTone;
  readonly text: string;
  /** Said as a warning (white text): a taken channel. */
  readonly warning: boolean;
}

/** "Claude", "Claude and Claude Code", "Claude, Claude Code and Cursor". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** AGENT-05 item 1: the line under the AI agents switch. */
export function agentsStatus(view: AgentsSettingsView): AgentsStatus {
  if (!view.on) return { tone: 'off', text: 'Off', warning: false };
  // A taken channel (D-185 Q3): agents can't start, whatever the switch says.
  if (view.problem) return { tone: 'off', text: `Off · ${view.problem}`, warning: true };
  if (view.paused) {
    const limit = view.presets[view.limits].changesPerHour;
    // The hourly budget ran out (D-185 Q8), or the user paused them (Proposed wording).
    const text =
      view.usedThisHour >= limit
        ? `Paused after ${limit.toLocaleString('en-US')} changes in an hour`
        : 'Paused: agents can only find and read until you resume';
    return { tone: 'paused', text, warning: false };
  }
  const who =
    view.connected.length > 0
      ? ` · ${namesText(view.connected)} connected`
      : ' · No app connected yet';
  return view.readOnly
    ? { tone: 'ro', text: `On, read-only: agents can only find and read${who}`, warning: false }
    : { tone: 'on', text: `On${who}`, warning: false };
}

/** The apps in Connect an app, in order, with the name each one connects as (D-185 Q4). */
export const CLIENTS: readonly {
  readonly app: ConnectApp;
  readonly name: string;
  /** The name it connects as (`clientInfo`, mapped). */
  readonly connectsAs: string;
}[] = [
  { app: 'claude-desktop', name: 'Claude Desktop', connectsAs: 'Claude' },
  { app: 'claude-code', name: 'Claude Code', connectsAs: 'Claude Code' },
  { app: 'cursor', name: 'Cursor', connectsAs: 'Cursor' },
  { app: 'vscode', name: 'VS Code', connectsAs: 'VS Code' },
];

/** Whether an app is connected now (only while agents are on). */
export function isConnected(view: AgentsSettingsView, app: ConnectApp): boolean {
  const client = CLIENTS.find((each) => each.app === app);
  return view.on && client !== undefined && view.connected.includes(client.connectsAs);
}

/** AGENT-04 (Davit, 13 Nov 2026): the skill's line and the one button it may need. */
export function skillState(skill: AgentsSettingsView['skill']): {
  readonly line: string | null;
  readonly action: 'install' | 'update' | null;
} {
  if (skill.installed === null) return { line: null, action: 'install' };
  if (!skill.ours)
    return {
      line: 'A Flint skill you added yourself is installed; Flint leaves it.',
      action: null,
    };
  // Flint updates its own copy when it starts; Update shows only when that didn't happen.
  if (skill.bundled !== null && skill.installed !== skill.bundled)
    return {
      line: `Installed for Claude Code · version ${skill.installed} · ${skill.bundled} is here`,
      action: 'update',
    };
  return { line: `Installed for Claude Code · version ${skill.installed}`, action: null };
}

const pad = (value: number): string => String(value).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** AGENT-07: when a change was made: "14:02", "Yesterday 18:20", "Sun 8 Mar 09:15" (Flint's time). */
export function changeTime(at: number, now: number): string {
  const when = new Date(at);
  const today = new Date(now);
  const time = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const day = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(today) - day(when)) / 86_400_000);
  if (days <= 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  return `${DAYS[when.getDay()] ?? ''} ${when.getDate()} ${MONTHS[when.getMonth()] ?? ''} ${time}`;
}
