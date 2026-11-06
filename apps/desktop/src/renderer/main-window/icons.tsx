import type { ReactElement } from 'react';

/** Icons from mockup 01 (Lucide-style strokes); no emoji anywhere (docs/09 §8). */

interface IconProps {
  readonly size?: number;
}

function svg(size: number, children: ReactElement | ReactElement[], width = 2): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const InboxIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [
    <path key="a" d="M22 12h-6l-2 3h-4l-2-3H2" />,
    <path
      key="b"
      d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"
    />,
  ]);

/** TODAY-01 (M6, mockup 03): Today's sun. */
export const SunIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [
    <circle key="a" cx="12" cy="12" r="4" />,
    <path
      key="b"
      d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
    />,
  ]);

export const ListIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [
    <path key="a" d="M9 6h11M9 12h11M9 18h11" />,
    <path key="b" d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />,
  ]);

export const NoteIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [
    <path key="a" d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />,
    <path key="b" d="M14 3v6h6M8 13h8M8 17h5" />,
  ]);

export const SettingsIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />);

export const BellIcon = ({ size = 12 }: IconProps): ReactElement =>
  svg(size, [
    <path key="a" d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />,
    <path key="b" d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />,
  ]);

/** LIST-06: the sidebar's sort button. */
export const SortIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, <path d="M4 7h16M7 12h10M10 17h4" />);

/** D-79: a task's body has images. */
export const ImageIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [
    <rect key="a" x="3" y="4" width="18" height="16" rx="3" />,
    <path key="b" d="m3.5 17 5-5 4 4 2.5-2.5 5.5 5.5" />,
    <circle key="c" cx="15.5" cy="9" r="1.5" />,
  ]);

export const BodyIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, <path d="M4 7h16M4 12h16M4 17h10" />);

export const BackIcon = ({ size = 15 }: IconProps): ReactElement =>
  svg(size, <path d="M19 12H5m6-6-6 6 6 6" />);

export const CloseIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, <path d="M6 6l12 12M18 6 6 18" />);

export const CheckIcon = ({ size = 12 }: IconProps): ReactElement =>
  svg(size, <path d="m5 12.5 4.5 4.5L19 7.5" />, 2.6);

export const ChevronIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, <path d="m9 6 6 6-6 6" />);

export const FlagIcon = ({ size = 15 }: IconProps): ReactElement =>
  svg(size, <path d="M5 21V4M5 4h11l-2 4 2 4H5" />, 1.9);

export const HashIcon = ({ size = 15 }: IconProps): ReactElement =>
  svg(size, <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />, 1.9);

/** NAV-01, D-106: the palette's pill (mockup 01). */
export const SearchIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [<circle key="a" cx="11" cy="11" r="7" />, <path key="b" d="m20 20-3.5-3.5" />], 2);

/** D-105: a link (the composer's link chips). */
export const LinkIcon = ({ size = 12 }: IconProps): ReactElement =>
  svg(size, [
    <path key="a" d="M9 17H7A5 5 0 0 1 7 7h2" />,
    <path key="b" d="M15 7h2a5 5 0 1 1 0 10h-2" />,
    <path key="c" d="M8 12h8" />,
  ]);

export const PlusIcon = ({ size = 13 }: IconProps): ReactElement =>
  svg(size, <path d="M12 5v14M5 12h14" />, 2);

/** REM-12: the bell, with a strike line that draws in when the reminder is turned off (CSS). */
export const ReminderBellIcon = ({ size = 12 }: IconProps): ReactElement =>
  svg(size, [
    <path key="a" d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />,
    <path key="b" d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />,
    <path key="c" className="bell-strike" d="M3 3l18 18" pathLength={1} />,
  ]);

/** NAV-07, D-83 (mockup 11): the context panel's "Open as page" and hide buttons. */
export const OpenPageIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [
    <path key="a" d="M14 4h6v6" />,
    <path key="b" d="M20 4 11 13" />,
    <path key="c" d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
  ]);

export const PanelIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [
    <rect key="a" x="3" y="4" width="18" height="16" rx="3" />,
    <path key="b" d="M15 4v16" />,
  ]);

/** MINI-01, D-109: mini mode (a small window in a screen's corner). */
export const MiniIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [
    <rect key="a" x="3" y="4" width="18" height="16" rx="3" />,
    <rect key="b" x="12" y="7" width="6" height="5" rx="1.5" />,
  ]);

/** TODAY-01, D-85: a pinned task (row indicator, menu). */
export const PinIcon = ({ size = 12 }: IconProps): ReactElement =>
  svg(size, [
    <path key="a" d="M12 17v5" />,
    <path
      key="b"
      d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
    />,
  ]);

/** D-110: the composer's send arrow in mini mode (mockup 05). */
export const SendIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [<path key="a" d="M12 19V5" />, <path key="b" d="m5 12 7-7 7 7" />], 2.2);

/** D-111: mini mode's "Reset size": two corners drawn in toward each other. */
export const ResetSizeIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [
    <path key="a" d="M4 14h6v6" />,
    <path key="b" d="M20 10h-6V4" />,
    <path key="c" d="m14 10 7-7" />,
    <path key="d" d="m3 21 7-7" />,
  ]);

/** DATA-02, D-97: the Trash row in the sidebar. */
export const TrashIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, [
    <path key="a" d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />,
    <path key="b" d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" />,
  ]);

/** DATA-02, D-97: a task in the Trash view (an empty checkbox). */
export const TaskIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, <rect x="4" y="4" width="16" height="16" rx="5" />);
