// Vitest setup (D-141 Q13): `FLINT_FUZZ_SEED` makes every fast-check property of a run use that
// seed, so a round of `npm run fuzz` can be repeated exactly.
import fc from 'fast-check';

const seed = process.env.FLINT_FUZZ_SEED;
if (seed !== undefined && seed !== '') fc.configureGlobal({ seed: Number(seed) });
