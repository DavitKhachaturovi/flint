import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type {
  AgentsAction,
  AgentsActionOutcome,
  AgentsSettingsView,
  ConnectApp,
} from '../../shared/agents.js';
import type { LimitsPreset } from '@flint/core/agents';
import { reducedMotion } from '../ui/motion.js';
import { agentsStatus, changeTime, CLIENTS, isConnected, skillState } from './agents-format.js';
import { GroupIcon, ListIcon, NoteIcon } from './icons.js';

/**
 * AGENT-05 to AGENT-07 (D-185, mockup 17): the parts of Settings → AI agents. Settings.tsx puts
 * them in its rows (so its search finds them); what each action said shows under its row and fades.
 */

/** The view main sends, loaded once and again whenever it changes (AGENT-05). */
export function useAgents(): {
  readonly view: AgentsSettingsView | null;
  readonly refresh: () => void;
} {
  const [view, setView] = useState<AgentsSettingsView | null>(null);
  const refresh = useCallback((): void => {
    void window.flintMain.agents().then((next) => {
      if (next) setView(next);
    });
  }, []);
  useEffect(() => {
    refresh();
    // Once: the bridge adds a listener per call.
    window.flintMain.onAgentsChanged(refresh);
  }, [refresh]);
  return { view, refresh };
}

/** What an action said, under its row. */
export interface Said {
  readonly text: string;
  readonly ok: boolean;
  readonly id: number;
}

let saidSeq = 0;

/** Runs an action and keeps what it said (per place: an app's row, the skill). */
export function useSaid(): {
  readonly said: Readonly<Record<string, Said>>;
  readonly act: (where: string, action: AgentsAction) => Promise<AgentsActionOutcome | null>;
  readonly clear: (where: string) => void;
} {
  const [said, setSaid] = useState<Readonly<Record<string, Said>>>({});
  const act = useCallback(
    async (where: string, action: AgentsAction): Promise<AgentsActionOutcome | null> => {
      const outcome = await window.flintMain.agentsAct(action);
      if (outcome?.message) {
        const text = outcome.message;
        setSaid((current) => ({ ...current, [where]: { text, ok: outcome.ok, id: ++saidSeq } }));
      }
      return outcome;
    },
    [],
  );
  const clear = useCallback((where: string): void => {
    setSaid((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key !== where)),
    );
  }, []);
  return { said, act, clear };
}

/**
 * A result said under a row: it fades in; a good one fades out again after a few seconds (an
 * error stays until the next try). Under reduce-motion it comes and goes at once (D-75).
 */
export function SaidLine(props: {
  readonly said: Said | undefined;
  readonly onDone: () => void;
}): ReactElement | null {
  const { said } = props;
  const [leaving, setLeaving] = useState(false);
  // The latest onDone, so a parent's re-render doesn't restart the line's time.
  const onDoneRef = useRef(props.onDone);
  onDoneRef.current = props.onDone;
  const onDone = (): void => onDoneRef.current();
  useEffect(() => {
    setLeaving(false);
    if (!said?.ok) return;
    const timer = window.setTimeout(() => {
      if (reducedMotion()) onDoneRef.current();
      else setLeaving(true);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [said?.id, said?.ok]);
  if (!said) return null;
  return (
    <span
      key={said.id}
      role="status"
      className={[
        'agents-said',
        'settings-said',
        said.ok ? '' : 'settings-warning',
        leaving ? 'leaving' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onDone();
      }}
    >
      {said.text}
    </span>
  );
}

/** AGENT-05 item 1: the status under the switch: its dot and line (mockup 17). */
export function AgentsStatusLine(props: { readonly view: AgentsSettingsView }): ReactElement {
  const status = agentsStatus(props.view);
  return (
    <span
      className={`agent-status ${status.tone}${status.warning ? ' settings-warning' : ''}`}
      data-tone={status.tone}
    >
      <i aria-hidden="true" />
      {/* D-89: a new status crossfades in (keyed by its text). */}
      <span key={status.text} className="settings-said agent-status-text">
        {status.text}
      </span>
    </span>
  );
}

const LEVELS: readonly { readonly value: LimitsPreset; readonly label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/**
 * AGENT-05 item 3 (D-185 Q8): Low / Medium / High; the numbers float beside the level the pointer
 * is on (not while read-only, when the row is dimmed).
 */
export function LimitsChoice(props: {
  readonly view: AgentsSettingsView;
  readonly onChange: (preset: LimitsPreset) => void;
}): ReactElement {
  const { view, onChange } = props;
  const [tip, setTip] = useState<LimitsPreset | null>(null);
  const shown = view.readOnly ? null : tip;
  const limits = shown ? view.presets[shown] : null;
  const number = (value: number): string => value.toLocaleString('en-US');
  return (
    <div className="limits-wrap" onMouseLeave={() => setTip(null)}>
      <div
        className="trash-tabs settings-choice"
        role="radiogroup"
        aria-label="Limits"
        aria-disabled={view.readOnly}
      >
        {LEVELS.map((level) => (
          <button
            key={level.value}
            type="button"
            role="radio"
            aria-checked={level.value === view.limits}
            disabled={view.readOnly}
            className={level.value === view.limits ? 'trash-tab on' : 'trash-tab'}
            onMouseEnter={() => setTip(level.value)}
            onFocus={() => setTip(level.value)}
            onBlur={() => setTip(null)}
            onClick={() => {
              if (level.value !== view.limits) onChange(level.value);
            }}
          >
            {level.label}
          </button>
        ))}
      </div>
      {shown && limits && (
        <div key={shown} className="limit-tip" role="tooltip">
          <div className="limit-tip-title">
            {LEVELS.find((level) => level.value === shown)?.label}
            {shown === 'medium' && <span> · the default</span>}
          </div>
          <div className="limit-tip-head">In one request</div>
          <div className="limit-tip-line">
            <b>{number(limits.itemsPerRequest)}</b>items
          </div>
          <div className="limit-tip-line">
            <b>{number(limits.taskDeletesPerRequest)}</b>task deletes
          </div>
          <div className="limit-tip-line">
            <b>{number(limits.listDeletesPerRequest)}</b>list, note or group deletes
          </div>
          <div className="limit-tip-sep" />
          <div className="limit-tip-head">In an hour</div>
          <div className="limit-tip-line">
            <b>{number(limits.changesPerHour)}</b>changes, all agents
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * AGENT-05 item 4 (AGENT-03): Claude Desktop, Claude Code, Cursor, VS Code: "Connected" while
 * one is; the quiet fallback (Copy setup) before the main action (D-104); Claude Code's command
 * in a well under its row; what each did said under it.
 */
export function ClientList(props: { readonly view: AgentsSettingsView }): ReactElement {
  const { view } = props;
  const { said, act, clear } = useSaid();
  const run = (app: ConnectApp, kind: 'connect' | 'copy'): void => void act(app, { kind, app });
  return (
    <ul className="agents-sub agents-clients">
      {CLIENTS.map((client) => (
        <ClientRow
          key={client.app}
          name={client.name}
          connected={isConnected(view, client.app)}
          actions={
            client.app === 'claude-desktop' ? (
              <button
                type="button"
                className="secondary-button agents-button"
                onClick={() => run(client.app, 'connect')}
              >
                Add to Claude Desktop
              </button>
            ) : client.app === 'claude-code' ? (
              <button
                type="button"
                className="secondary-button agents-button"
                onClick={() => run(client.app, 'copy')}
              >
                Copy command
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="trash-action"
                  onClick={() => run(client.app, 'copy')}
                >
                  Copy setup
                </button>
                <button
                  type="button"
                  className="secondary-button agents-button"
                  onClick={() => run(client.app, 'connect')}
                >
                  Add to {client.name}
                </button>
              </>
            )
          }
          said={said[client.app]}
          onSaidDone={() => clear(client.app)}
          // Claude Desktop not installed: its setup to copy instead (AGENT-03).
          fallback={
            client.app === 'claude-desktop' && said[client.app]?.ok === false ? (
              <button
                type="button"
                className="trash-action"
                onClick={() => run(client.app, 'copy')}
              >
                Copy setup
              </button>
            ) : null
          }
        >
          {client.app === 'claude-code' && (
            <li className="agents-command">
              <span className="agents-command-line">
                <span className="agents-command-prompt">&gt; </span>
                {view.claudeCodeCommand}
              </span>
              <span className="settings-note">
                Claude Code can also work through the <code className="agents-code">flint</code>{' '}
                command in its terminal; the skill below teaches it how.
              </span>
            </li>
          )}
        </ClientRow>
      ))}
      {/* D-185 Q14, the 1.8.0 preview: the reason as it is, and a way to fix a missing entry. */}
      {view.cli.onPath === false && view.cli.pathProblem === 'too-long' && (
        <li className="settings-note agents-path-note">
          The flint command isn’t on your PATH (it was too long to change safely). The apps above
          use its full path, so they work.
        </li>
      )}
      {view.cli.onPath === false && view.cli.pathProblem === 'missing' && (
        <li className="settings-note agents-path-note agents-path-missing">
          <span>
            The flint command isn’t on your PATH yet, so a terminal can’t find it. The apps above
            use its full path, so they work.
          </span>
          <button
            type="button"
            className="trash-action"
            onClick={() => void act('path', { kind: 'addToPath' })}
          >
            Add to PATH
          </button>
          <SaidLine said={said['path']} onDone={() => clear('path')} />
        </li>
      )}
    </ul>
  );
}

function ClientRow(props: {
  readonly name: string;
  readonly connected: boolean;
  readonly actions: ReactElement;
  readonly fallback: ReactElement | null;
  readonly said: Said | undefined;
  readonly onSaidDone: () => void;
  readonly children?: ReactElement | false;
}): ReactElement {
  const { name, connected, actions, fallback, said, onSaidDone, children } = props;
  return (
    <>
      <li className="link-pattern agents-client" aria-label={name}>
        <span className="agents-client-name">{name}</span>
        <span className="agents-client-state">
          {connected && <span className="settings-said">Connected</span>}
        </span>
        <span className="link-pattern-actions">
          {fallback}
          {actions}
        </span>
      </li>
      {said && (
        <li className="agents-said-line">
          <SaidLine said={said} onDone={onSaidDone} />
        </li>
      )}
      {children}
    </>
  );
}

/** AGENT-05 item 5 (AGENT-04): the skill's buttons. */
export function SkillButtons(props: {
  readonly view: AgentsSettingsView;
  readonly act: (where: string, action: AgentsAction) => Promise<AgentsActionOutcome | null>;
}): ReactElement {
  const { view, act } = props;
  const state = skillState(view.skill);
  return (
    <>
      <button
        type="button"
        className="trash-action"
        onClick={() => void act('skill', { kind: 'saveSkill' })}
      >
        Save for claude.ai…
      </button>
      {state.action && (
        <button
          type="button"
          className="secondary-button agents-button"
          onClick={() => void act('skill', { kind: 'installSkill' })}
        >
          {state.action === 'install' ? 'Install for Claude Code' : 'Update'}
        </button>
      )}
    </>
  );
}

/** The skill's version line (AGENT-04), crossfading when it changes. */
export function SkillLine(props: { readonly view: AgentsSettingsView }): ReactElement | null {
  const line = skillState(props.view.skill).line;
  if (!line) return null;
  return (
    <span className="agent-status agents-skill-line">
      <span key={line} className="settings-said">
        {line}
      </span>
    </span>
  );
}

/**
 * Items gone from a list stay a moment, folding away (mockup 17); the rest as they are. Under
 * reduce-motion they go at once (D-75).
 */
function useFolding<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): {
  readonly shown: readonly { item: T; leaving: boolean }[];
  readonly done: (key: string) => void;
} {
  const [leaving, setLeaving] = useState<ReadonlyMap<string, { item: T; index: number }>>(
    new Map(),
  );
  const previous = useRef(items);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = items;
    const now = new Set(items.map(keyOf));
    setLeaving((current) => {
      const next = new Map([...current].filter(([key]) => !now.has(key)));
      if (!reducedMotion())
        before.forEach((item, index) => {
          const key = keyOf(item);
          if (!now.has(key) && !next.has(key)) next.set(key, { item, index });
        });
      return next.size === 0 && current.size === 0 ? current : next;
    });
  }, [items, keyOf]);
  const shown: { item: T; leaving: boolean }[] = items.map((item) => ({ item, leaving: false }));
  for (const { item, index } of [...leaving.values()].sort((a, b) => a.index - b.index))
    shown.splice(Math.min(index, shown.length), 0, { item, leaving: true });
  const done = useCallback((key: string): void => {
    setLeaving((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);
  return { shown, done };
}

/** Keys new since the list was first shown (they slide in; the first ones are just there). */
function useFresh(keys: readonly string[]): ReadonlySet<string> {
  const known = useRef<ReadonlySet<string> | null>(null);
  const fresh = known.current
    ? new Set(keys.filter((key) => !known.current?.has(key)))
    : new Set<string>();
  useEffect(() => {
    known.current = new Set([...(known.current ?? []), ...keys]);
  }, [keys]);
  return fresh;
}

/** A row going: its height is fixed first, so it can fold to nothing. */
const foldFrom = (element: HTMLElement | null): void => {
  if (element && element.style.maxHeight === '')
    element.style.maxHeight = `${element.offsetHeight}px`;
};

type HiddenItem = AgentsSettingsView['hidden'][number];

/** AGENT-06: the hidden lists, notes and groups, each with Show to agents; shown ones fold away. */
export function HiddenList(props: { readonly view: AgentsSettingsView }): ReactElement {
  const { view } = props;
  const keyOf = useCallback((item: HiddenItem): string => item.id, []);
  const { shown, done } = useFolding(view.hidden, keyOf);
  const fresh = useFresh(view.hidden.map((item) => item.id));
  if (shown.length === 0)
    return (
      <ul className="agents-sub" aria-label="Hidden from agents">
        <li className="agents-empty">Nothing is hidden.</li>
      </ul>
    );
  return (
    <ul className="agents-sub" aria-label="Hidden from agents">
      {shown.map(({ item, leaving }) => (
        <li
          key={item.id}
          ref={leaving ? foldFrom : undefined}
          className={[
            'link-pattern',
            'agents-hidden',
            leaving ? 'agents-fold' : fresh.has(item.id) ? 'agents-enter' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden={leaving || undefined}
          onAnimationEnd={(event) => {
            if (leaving && event.target === event.currentTarget) done(item.id);
          }}
        >
          <span className="tile agents-hidden-tile">
            {item.kind === 'group' ? (
              <GroupIcon />
            ) : item.kind === 'note' ? (
              <NoteIcon size={13} />
            ) : (
              <ListIcon size={13} />
            )}
          </span>
          <span className="link-pattern-label agents-hidden-name">{item.name}</span>
          <span className="agents-kind">{item.kind}</span>
          <span className="link-pattern-actions">
            <button
              type="button"
              className="trash-action"
              disabled={leaving}
              onClick={() =>
                void window.flintMain.agentsAct({ kind: 'hide', id: item.id, hide: false })
              }
            >
              Show to agents
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * AGENT-07: what agents changed, newest first (the newest 20): who, what, when (Flint's time), and
 * Undo, or a faint "Undone". New entries slide in; an undone one goes faint and Undo crossfades.
 */
export function RecentChanges(props: {
  readonly view: AgentsSettingsView;
  readonly onUndo: (id: string) => void;
}): ReactElement {
  const { view, onUndo } = props;
  const fresh = useFresh(view.changes.map((change) => change.id));
  const now = Date.now();
  if (view.changes.length === 0)
    return (
      <ul className="agents-sub" aria-label="Recent agent changes">
        <li className="agents-empty">No agent changes yet.</li>
      </ul>
    );
  return (
    <ul className="agents-sub" aria-label="Recent agent changes">
      {view.changes.map((change) => (
        <li
          key={change.id}
          className={[
            'agents-change',
            change.undone ? 'is-undone' : '',
            fresh.has(change.id) ? 'agents-enter' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="agents-change-who">{change.agent}</span>
          <span className="agents-change-what" title={change.label}>
            {change.label}
          </span>
          <span className="agents-change-when">{changeTime(change.at, now)}</span>
          <span className="agents-change-act">
            {change.undone ? (
              <span className="agents-undone">Undone</span>
            ) : change.undoable ? (
              <button type="button" className="trash-action" onClick={() => onUndo(change.id)}>
                Undo
              </button>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
