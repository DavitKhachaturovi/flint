/**
 * NAV-01, D-106: the Ctrl+K palette's matching, shared by the main process (tasks, notes, Trash)
 * and the window (places, commands). Every word of the query must match: as a piece of the text
 * (best at a word's start), or for one-word queries as its letters in order (word starts and runs
 * count more). The score orders the results; the indices are the letters shown highlighted.
 */

export interface FuzzyMatch {
  readonly score: number;
  readonly indices: readonly number[];
}

const WORD = /[\p{L}\p{N}]/u;

const startsWord = (text: string, at: number): boolean =>
  at === 0 ||
  !WORD.test(text[at - 1] ?? '') ||
  (/[a-z]/.test(text[at - 1] ?? '') && /[A-Z]/.test(text[at] ?? ''));

/** One query word in the text: where, and how well. */
function matchWord(word: string, text: string, lower: string): FuzzyMatch | null {
  // A piece of the text, preferring one at a word's start.
  let best: FuzzyMatch | null = null;
  for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + 1)) {
    const score = 100 + (startsWord(text, at) ? 60 : 0) - Math.min(at, 40) * 0.5;
    if (!best || score > best.score)
      best = { score, indices: Array.from({ length: word.length }, (_, index) => at + index) };
  }
  return best;
}

/** The query's letters in order, anywhere (for a single word that isn't a piece of the text). */
function matchLetters(word: string, text: string, lower: string): FuzzyMatch | null {
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  for (const letter of word) {
    const at = lower.indexOf(letter, from);
    if (at < 0) return null;
    const run = indices.length > 0 && indices[indices.length - 1] === at - 1;
    score += (startsWord(text, at) ? 8 : 1) + (run ? 4 : 0);
    indices.push(at);
    from = at + 1;
  }
  // Letters far apart match weakly; too weak and it isn't a match at all.
  const spread = (indices[indices.length - 1] ?? 0) - (indices[0] ?? 0) + 1;
  score -= Math.max(0, spread - word.length) * 0.3;
  return score >= word.length * 2 ? { score, indices } : null;
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0) return { score: 0, indices: [] };
  const lower = text.toLowerCase();
  let score = 0;
  const indices = new Set<number>();
  for (const word of words) {
    const found =
      matchWord(word, text, lower) ?? (words.length === 1 ? matchLetters(word, text, lower) : null);
    if (!found) return null;
    score += found.score;
    for (const index of found.indices) indices.add(index);
  }
  // A shorter text that matches as well is the likelier one.
  score -= Math.min(text.length, 200) * 0.05;
  return { score, indices: [...indices].sort((a, b) => a - b) };
}
