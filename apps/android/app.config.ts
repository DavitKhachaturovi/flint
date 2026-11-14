/**
 * Flint for Android's Expo config (D-165, docs/05 §8). The development build is its own app
 * (`app.flintnotes.dev`, "Flint (development)") beside the installed one, as the desktop's
 * development build is (D-33); both sync with their own Drive folder (D-161 Q7).
 */
import type { ExpoConfig } from 'expo/config';
import pkg from './package.json';

const release = process.env['FLINT_ANDROID_RELEASE'] === '1';

const config: ExpoConfig = {
  name: release ? 'Flint' : 'Flint (development)',
  slug: 'flint',
  version: pkg.version,
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0D0E10',
  platforms: ['android'],
  android: {
    package: release ? 'app.flintnotes' : 'app.flintnotes.dev',
    // D-165 Q4: nothing reaches Google unless the user syncs it.
    allowBackup: false,
  },
  plugins: [],
  extra: {
    driveFolder: release ? 'Flint' : 'Flint (development)',
  },
};

export default config;
