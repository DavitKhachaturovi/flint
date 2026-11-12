import { useEffect, useState, type ReactElement } from 'react';
import type { MiniAlert, MiniAlertAction, TodayReminder } from '../../shared/ipc.js';
import { BellIcon, CloseIcon } from '../main-window/icons.js';
import { untilLabel, useNow } from '../ui/presence.js';

/**
 * REM-06, TODAY-03, D-109, D-110 (mockup 05): mini mode's reminder card, in the look of Today's
 * "next" reminder card (the strong bell tile, the time in mono, the title in white). On Today it
 * shows the next reminder still to come today with a live countdown; when a reminder fires, the same
 * card turns into the alert: Done · Snooze 10m · Open (D, S, O when no text field has the caret),
 * an X at its top right that only takes the card away (D-179),
 * "1 of N" when several wait. On Inbox and Note the alert rises in at the top. It folds in and out
 * (height and fade), and its content crossfades when it turns; it never takes the focus.
 */
export function MiniReminder(props: {
  readonly alert: MiniAlert | null;
  readonly waiting: number;
  /** The next reminder to come today (Today's tab only), or null. */
  readonly upcoming: TodayReminder | null;
  readonly onAct: (action: MiniAlertAction) => void;
  /** A click on the upcoming card selects its row; a double-click opens it in the main window. */
  readonly onSelect: (reminder: TodayReminder) => void;
  readonly onOpen: (reminder: TodayReminder) => void;
}): ReactElement {
  const { alert, waiting, upcoming, onAct, onSelect, onOpen } = props;
  const now = useNow(1000);
  const kind = alert ? 'alert' : upcoming ? 'next' : null;
  // What is shown stays while the card folds away.
  const [shown, setShown] = useState<{
    alert: MiniAlert | null;
    upcoming: TodayReminder | null;
  } | null>(kind ? { alert, upcoming } : null);
  useEffect(() => {
    if (kind) setShown({ alert, upcoming });
  }, [kind, alert, upcoming]);
  const content = kind ? { alert, upcoming } : shown;
  // The content's key: a new alert or another reminder crossfades in.
  const key = content?.alert ? `alert-${content.alert.id}` : `next-${content?.upcoming?.key ?? ''}`;
  return (
    <div
      className={kind ? 'mini-reminder-fold open' : 'mini-reminder-fold'}
      aria-hidden={!kind}
      // Folded away: what it showed goes.
      onTransitionEnd={(event) => {
        if (!kind && event.target === event.currentTarget) setShown(null);
      }}
    >
      <div className="mini-reminder-clip">
        {content && (
          <section
            className={
              content.alert
                ? 'card reminder-card next mini-reminder alert'
                : 'card reminder-card next mini-reminder'
            }
            role={content.alert ? 'alert' : undefined}
            aria-label="Reminder"
            inert={!kind}
            onClick={() => !content.alert && content.upcoming && onSelect(content.upcoming)}
            onDoubleClick={() => !content.alert && content.upcoming && onOpen(content.upcoming)}
          >
            <div key={key} className="mini-reminder-body">
              <div className="mini-reminder-top">
                <span className="tile strong">
                  <BellIcon size={13} />
                </span>
                <span className="mini-reminder-text">
                  <span className="mini-reminder-label">
                    {content.alert
                      ? `${content.alert.label}${waiting > 1 ? ` · 1 of ${waiting}` : ''}`
                      : `Next · ${content.upcoming?.time ?? ''}`}
                  </span>
                  <span className="mini-reminder-title">
                    {content.alert ? content.alert.title : content.upcoming?.title}
                  </span>
                </span>
                {content.alert && (
                  // D-179: the X takes the card away; the task stays as it is.
                  <button
                    type="button"
                    className="tool mini-reminder-dismiss"
                    aria-label="Dismiss"
                    title="Dismiss"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onAct('dismiss')}
                  >
                    <CloseIcon size={12} />
                  </button>
                )}
                {!content.alert && content.upcoming && (
                  <span className="mini-reminder-until">
                    {untilLabel(content.upcoming.at, now)}
                  </span>
                )}
              </div>
              {content.alert && (
                <div className="mini-reminder-actions">
                  <button type="button" className="primary-button" onClick={() => onAct('done')}>
                    Done <span className="keycap">D</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onAct('snooze')}
                  >
                    Snooze 10m <span className="keycap">S</span>
                  </button>
                  <button type="button" className="secondary-button" onClick={() => onAct('open')}>
                    Open <span className="keycap">O</span>
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
