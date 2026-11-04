import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { SHORTCUTS } from '../../shared/shortcuts.js';

/**
 * NAV-02, D-80, D-106: the `?` cheat sheet: every shortcut, from the list Settings' Keyboard
 * shortcuts shows, on a card like the palette's, in two columns by group; typing narrows it down.
 * `?` (with the field empty) or Esc closes it.
 */
export function CheatSheet(props: { readonly onClose: () => void }): ReactElement {
  const { onClose } = props;
  const [filter, setFilter] = useState('');
  const [leaving, setLeaving] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => field.current?.focus(), []);
  const close = (): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) onClose();
    else setLeaving(true);
  };
  const text = filter.trim().toLowerCase();
  const groups = SHORTCUTS.map((group) => ({
    ...group,
    shortcuts: group.shortcuts.filter(
      (shortcut) =>
        text === '' ||
        group.name.toLowerCase().includes(text) ||
        `${shortcut.keys} ${shortcut.action}`.toLowerCase().includes(text),
    ),
  })).filter((group) => group.shortcuts.length > 0);
  return (
    <div
      className={leaving ? 'palette-layer leaving' : 'palette-layer'}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette cheat-sheet" role="dialog" aria-label="Keyboard shortcuts">
        <div className="palette-head">
          <span className="palette-crumb">Keyboard shortcuts</span>
          <input
            ref={field}
            className="palette-field"
            value={filter}
            placeholder="Find a shortcut"
            aria-label="Find a shortcut"
            spellCheck={false}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || (event.key === '?' && filter === '')) {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          />
          <span className="keycap">Esc</span>
        </div>
        <div className="cheat-columns">
          {groups.length === 0 && <p className="palette-empty">No shortcut matches.</p>}
          {groups.map((group) => (
            <section key={group.name} className="cheat-group" aria-label={group.name}>
              <div className="palette-label">{group.name}</div>
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.keys + shortcut.action} className="cheat-row">
                  <span className="cheat-action">{shortcut.action}</span>
                  <span className="keycap">{shortcut.keys}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
