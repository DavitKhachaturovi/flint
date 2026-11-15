// Flint for Android's bundler (D-165): Expo's defaults for a monorepo, plus two things for the
// workspace packages (@flint/core, @flint/editor), which the desktop's build reads from source:
// - their "source" export condition, only for them (another package's would point at files it
//   doesn't ship);
// - their imports written the TypeScript way (`./check.js` for `check.ts`).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const flint = moduleName.startsWith('@flint/');
  const inFlint = /[\\/]packages[\\/](core|editor)[\\/]src[\\/]/.test(context.originModulePath);
  const here = flint
    ? { ...context, unstable_conditionNames: ['source', ...context.unstable_conditionNames] }
    : context;
  try {
    return here.resolveRequest(here, moduleName, platform);
  } catch (error) {
    if (inFlint && moduleName.startsWith('.') && moduleName.endsWith('.js'))
      return here.resolveRequest(here, moduleName.slice(0, -3), platform);
    throw error;
  }
};

module.exports = config;
