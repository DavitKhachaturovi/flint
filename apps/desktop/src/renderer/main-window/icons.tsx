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

export const BodyIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, <path d="M4 7h16M4 12h16M4 17h10" />);

export const CheckIcon = ({ size = 12 }: IconProps): ReactElement =>
  svg(size, <path d="m5 12.5 4.5 4.5L19 7.5" />, 2.6);

export const ChevronIcon = ({ size = 14 }: IconProps): ReactElement =>
  svg(size, <path d="m9 6 6 6-6 6" />);

export const FlagIcon = ({ size = 15 }: IconProps): ReactElement =>
  svg(size, <path d="M5 21V4M5 4h11l-2 4 2 4H5" />, 1.9);

export const HashIcon = ({ size = 15 }: IconProps): ReactElement =>
  svg(size, <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />, 1.9);
