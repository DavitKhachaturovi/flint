import { describe, expect, it } from 'vitest';
import type { AgentsSettingsView } from '../../shared/agents.js';
import { agentsStatus, changeTime, isConnected, namesText, skillState } from './agents-format.js';

const LIMITS = {
  itemsPerRequest: 100,
  taskDeletesPerRequest: 25,
  listDeletesPerRequest: 5,
  changesPerHour: 500,
};

const view = (patch: Partial<AgentsSettingsView> = {}): AgentsSettingsView => ({
  on: true,
  readOnly: false,
  paused: false,
  limits: 'medium',
  presets: { low: LIMITS, medium: LIMITS, high: { ...LIMITS, changesPerHour: 2000 } },
  usedThisHour: 0,
  connected: [],
  problem: null,
  changes: [],
  hidden: [],
  cli: { path: 'C:\\Flint\\resources\\bin\\flint.exe', onPath: true },
  claudeCodeCommand: 'claude mcp add --scope user flint -- flint.exe mcp',
  skill: { installed: null, ours: false, bundled: '1.8.0' },
  ...patch,
});

describe('Settings → AI agents: the status line (AGENT-05, mockup 17)', () => {
  it('says off, on with the apps connected, read-only and a taken channel', () => {
    expect(agentsStatus(view({ on: false }))).toEqual({ tone: 'off', text: 'Off', warning: false });
    expect(agentsStatus(view()).text).toBe('On · No app connected yet');
    expect(agentsStatus(view({ connected: ['Claude', 'Claude Code'] })).text).toBe(
      'On · Claude and Claude Code connected',
    );
    expect(agentsStatus(view({ readOnly: true, connected: ['Claude'] }))).toEqual({
      tone: 'ro',
      text: 'On, read-only: agents can only find and read · Claude connected',
      warning: false,
    });
    expect(agentsStatus(view({ problem: 'Another program is using it.' }))).toEqual({
      tone: 'off',
      text: 'Off · Another program is using it.',
      warning: true,
    });
  });

  it('says why changes are paused: the hourly budget, or by hand', () => {
    expect(agentsStatus(view({ paused: true, usedThisHour: 500 })).text).toBe(
      'Paused after 500 changes in an hour',
    );
    expect(agentsStatus(view({ paused: true, limits: 'high', usedThisHour: 2000 })).text).toBe(
      'Paused after 2,000 changes in an hour',
    );
    expect(agentsStatus(view({ paused: true, usedThisHour: 3 })).tone).toBe('paused');
  });

  it('joins names as a sentence', () => {
    expect(namesText([])).toBe('');
    expect(namesText(['Claude'])).toBe('Claude');
    expect(namesText(['Claude', 'Claude Code', 'Cursor'])).toBe('Claude, Claude Code and Cursor');
  });

  it('maps the apps to the names they connect as, only while agents are on', () => {
    expect(isConnected(view({ connected: ['Claude'] }), 'claude-desktop')).toBe(true);
    expect(isConnected(view({ connected: ['Claude'] }), 'claude-code')).toBe(false);
    expect(isConnected(view({ connected: ['VS Code'] }), 'vscode')).toBe(true);
    expect(isConnected(view({ on: false, connected: ['Claude'] }), 'claude-desktop')).toBe(false);
  });
});

describe('the skill row (AGENT-04, Davit 13 Nov 2026)', () => {
  it('shows the version only; Update after a failed automatic update; leaves a copy of the user’s', () => {
    expect(skillState({ installed: null, ours: false, bundled: '1.8.0' })).toEqual({
      line: null,
      action: 'install',
    });
    expect(skillState({ installed: '1.8.0', ours: true, bundled: '1.8.0' })).toEqual({
      line: 'Installed for Claude Code · version 1.8.0',
      action: null,
    });
    expect(skillState({ installed: '1.7.0', ours: true, bundled: '1.8.0' })).toEqual({
      line: 'Installed for Claude Code · version 1.7.0 · 1.8.0 is here',
      action: 'update',
    });
    expect(skillState({ installed: '0.1', ours: false, bundled: '1.8.0' })).toEqual({
      line: 'A Flint skill you added yourself is installed; Flint leaves it.',
      action: null,
    });
  });
});

describe('a change’s time (AGENT-07)', () => {
  // Tuesday 10 March 2026, 10:00 (the end-to-end tests' day, D-107).
  const now = new Date(2026, 2, 10, 10, 0).getTime();
  it('is the time today, Yesterday and the time, else the day', () => {
    expect(changeTime(new Date(2026, 2, 10, 9, 5).getTime(), now)).toBe('09:05');
    expect(changeTime(new Date(2026, 2, 9, 18, 20).getTime(), now)).toBe('Yesterday 18:20');
    expect(changeTime(new Date(2026, 2, 8, 7, 0).getTime(), now)).toBe('Sun 8 Mar 07:00');
  });
});
