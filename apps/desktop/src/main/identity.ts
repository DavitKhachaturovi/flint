/**
 * App identity (D-33). The AppUserModelID drives toasts and Windows' notification settings, the
 * start-with-Windows entry and the installer's upgrade detection, so the installed one must never
 * change. Development and benchmark builds get their own identity, so they never touch an installed
 * Flint: not its toasts, its `flint://` handler, its app data or its single-instance lock.
 */

export type BuildKind = 'installed' | 'development' | 'bench';

export interface Identity {
  /** AppUserModelID; for installed builds also electron-builder's `appId`. */
  readonly appId: string;
  /** Scheme toast buttons launch (docs/05 §5); null: the build registers none. */
  readonly protocol: string | null;
  /** Folder name for app data and logs (docs/04 §2), and the tray tooltip. */
  readonly name: string;
}

export const IDENTITIES: Readonly<Record<BuildKind, Identity>> = {
  installed: { appId: 'app.flint.desktop', protocol: 'flint', name: 'Flint' },
  development: {
    appId: 'app.flint.desktop.dev',
    protocol: 'flint-dev',
    name: 'Flint (development)',
  },
  // The R-1 laptop benchmark (docs/06 §1) shows no toasts and registers nothing.
  bench: { appId: 'app.flint.desktop.bench', protocol: null, name: 'Flint R-1 benchmark' },
};
