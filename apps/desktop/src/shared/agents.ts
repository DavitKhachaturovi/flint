import type { Limits, LimitsPreset } from '@flint/core/agents';

/** AGENT-05 (D-185): what Settings → AI agents shows, and what it can ask of main. */

export type ConnectApp = 'claude-desktop' | 'claude-code' | 'cursor' | 'vscode';

export interface AgentChangeView {
  readonly id: string;
  readonly agent: string;
  readonly label: string;
  /** ms */
  readonly at: number;
  readonly undoable: boolean;
  readonly undone: boolean;
}

export interface AgentsSettingsView {
  readonly on: boolean;
  readonly readOnly: boolean;
  readonly paused: boolean;
  readonly limits: LimitsPreset;
  readonly presets: Readonly<Record<LimitsPreset, Limits>>;
  readonly usedThisHour: number;
  /** Agents connected now (`Claude`, `Claude Code`). */
  readonly connected: readonly string[];
  /** Why agents can't start, or null. */
  readonly problem: string | null;
  readonly changes: readonly AgentChangeView[];
  readonly hidden: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: 'list' | 'note' | 'group';
  }[];
  /** `flint.exe`'s full path, and whether its folder is on the user's PATH (null: unknown). */
  readonly cli: {
    readonly path: string;
    readonly onPath: boolean | null;
    /**
     * Why it isn't on the PATH: the value too long (or unreadable) to change safely, or simply
     * missing (Settings offers Add to PATH); null when it is, or unknown (development builds).
     */
    readonly pathProblem: 'too-long' | 'missing' | null;
  };
  readonly claudeCodeCommand: string;
  /** The skill in `~/.claude/skills/flint`: its version (null: not installed), and whether Flint installed it. */
  readonly skill: {
    readonly installed: string | null;
    readonly ours: boolean;
    readonly bundled: string | null;
  };
}

export type AgentsAction =
  | { readonly kind: 'on'; readonly on: boolean }
  | { readonly kind: 'readOnly'; readonly readOnly: boolean }
  | { readonly kind: 'limits'; readonly preset: LimitsPreset }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  /** Undo one change (by ID), or the newest one. */
  | { readonly kind: 'undo'; readonly id?: string }
  | { readonly kind: 'hide'; readonly id: string; readonly hide: boolean }
  /** Add to Claude Desktop, Cursor or VS Code (their own install dialogs). */
  | { readonly kind: 'connect'; readonly app: ConnectApp }
  /** Copy setup (JSON) or Claude Code's command, to the clipboard. */
  | { readonly kind: 'copy'; readonly app: ConnectApp }
  | { readonly kind: 'installSkill' }
  /** D-185 Q14: puts flint.exe's folder on the user's PATH, as the installer does. */
  | { readonly kind: 'addToPath' }
  | { readonly kind: 'saveSkill' };

export interface AgentsActionOutcome {
  readonly ok: boolean;
  /** Said under the row (or in a toast): "Copied", "Claude Desktop isn't installed". */
  readonly message?: string;
}

/** Main → windows: an agent changed these (AGENT-07: the rows flash once). */
export interface AgentChangedEvent {
  readonly keys: readonly string[];
  readonly lists: readonly string[];
}

/** Main → main window: agent changes paused after the hourly budget (D-185 Q8). */
export interface AgentsPausedEvent {
  readonly agent: string;
  readonly limit: number;
}
