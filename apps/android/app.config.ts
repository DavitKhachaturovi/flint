/**
 * Flint for Android's Expo config (D-165, docs/05 §8). The development build is its own app
 * (`app.flintnotes.dev`, "Flint (development)") beside the installed one, as the desktop's
 * development build is (D-33); both sync with their own Drive folder (D-161 Q7).
 */
import type { ExpoConfig } from 'expo/config';
import { withAppBuildGradle, type ConfigPlugin } from 'expo/config-plugins';
import pkg from './package.json';

const release = process.env['FLINT_ANDROID_RELEASE'] === '1';

const CMAKE_MARK = '// Flint (D-165): newest CMake';

/**
 * D-165: the build uses the newest CMake installed in the Android SDK. Android's default (3.22.1)
 * brings ninja 1.10, which can't create folders past Windows' 260 characters, and React Native's
 * C++ code generation nests deep folders under app/.cxx (found on the first build, 14 Nov 2026).
 * Newer CMake brings ninja 1.12 or later, which follows Windows' long-path setting.
 */
const withNewestCmake: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (mod) => {
    if (mod.modResults.contents.includes(CMAKE_MARK)) return mod;
    mod.modResults.contents += [
      '',
      CMAKE_MARK,
      "def flintCmakeDir = new File(android.sdkDirectory, 'cmake')",
      'def flintCmake = (flintCmakeDir.listFiles() ?: [])',
      '    .findAll { it.isDirectory() && it.name ==~ /\\d+\\.\\d+\\.\\d+.*/ }',
      '    .collect { it.name }',
      '    .max { a, b ->',
      "        def x = a.tokenize('.').take(3).collect { it.replaceAll(/\\D.*/, '') as int }",
      "        def y = b.tokenize('.').take(3).collect { it.replaceAll(/\\D.*/, '') as int }",
      '        (0..2).collect { x[it] <=> y[it] }.find { it != 0 } ?: 0',
      '    }',
      'if (flintCmake != null) {',
      '    android.externalNativeBuild.cmake.version = flintCmake',
      '}',
      '',
    ].join('\n');
    return mod;
  });

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
  extra: {
    driveFolder: release ? 'Flint' : 'Flint (development)',
  },
};

export default withNewestCmake(config);
