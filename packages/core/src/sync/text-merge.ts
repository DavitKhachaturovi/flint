/**
 * Three-way text merge (diff3) for notes, task bodies and non-task text (SYNC-01, D-161 Q5,
 * docs/04 §7). Changes to different lines combine; where both sides changed the same lines, this
 * PC's lines stay and the other side's follow in a conflict callout (never lost, never a copy file).
 */
import { fenceOpen, isFenceClose, type Fence } from '../format/markdown-blocks.js';
import { dominantEol, splitLines } from '../format/lines.js';
import { conflictCallout, type ConflictLabels } from './conflict.js';
import { diffLines, type Hunk } from './diff.js';

export interface TextMergeResult {
  readonly text: string;
  /** How many conflict callouts the merge added. */
  readonly conflicts: number;
}

interface SideHunk extends Hunk {
  readonly side: 'mine' | 'theirs';
}

interface Region {
  start: number;
  end: number;
  hunks: SideHunk[];
}

/** The lines one side has where the base has `[start, end)`, given its hunks inside that range. */
function sideLines(
  base: readonly string[],
  side: readonly string[],
  hunks: readonly SideHunk[],
  start: number,
  end: number,
): string[] {
  if (hunks.length === 0) return base.slice(start, end);
  const first = hunks[0] as SideHunk;
  const last = hunks[hunks.length - 1] as SideHunk;
  return side.slice(first.bStart - (first.aStart - start), last.bEnd + (end - last.aEnd));
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/**
 * Merges line arrays. `base` null is a first meeting: the lines both sides have in common act as
 * the base, so only what differs can conflict.
 */
export function mergeLines(
  base: readonly string[] | null,
  mine: readonly string[],
  theirs: readonly string[],
  labels: ConflictLabels,
): { lines: string[]; conflicts: number } {
  if (sameLines(mine, theirs)) return { lines: [...mine], conflicts: 0 };
  let ground: readonly string[];
  if (base === null) {
    // The common lines, in order: what both sides kept of an (unknown) shared start.
    const common: string[] = [];
    let x = 0;
    for (const hunk of diffLines(mine, theirs)) {
      common.push(...mine.slice(x, hunk.aStart));
      x = hunk.aEnd;
    }
    common.push(...mine.slice(x));
    ground = common;
  } else {
    if (sameLines(mine, base)) return { lines: [...theirs], conflicts: 0 };
    if (sameLines(theirs, base)) return { lines: [...mine], conflicts: 0 };
    ground = base;
  }

  const hunks: SideHunk[] = [
    ...diffLines(ground, mine).map((hunk): SideHunk => ({ ...hunk, side: 'mine' })),
    ...diffLines(ground, theirs).map((hunk): SideHunk => ({ ...hunk, side: 'theirs' })),
  ].sort((a, b) => a.aStart - b.aStart || a.aEnd - b.aEnd);

  // Hunks that touch the same base lines, or insert where the other changes, form one region.
  const regions: Region[] = [];
  for (const hunk of hunks) {
    const current = regions[regions.length - 1];
    const overlaps =
      current !== undefined &&
      (hunk.aStart < current.end ||
        (hunk.aStart === current.end &&
          (hunk.aStart === hunk.aEnd || current.start === current.end)));
    if (current && overlaps) {
      current.end = Math.max(current.end, hunk.aEnd);
      current.hunks.push(hunk);
    } else {
      regions.push({ start: hunk.aStart, end: hunk.aEnd, hunks: [hunk] });
    }
  }

  const out: string[] = [];
  let fence: Fence | null = null;
  const pending: string[][] = [];
  let conflicts = 0;
  const emit = (line: string): void => {
    out.push(line);
    if (fence === null) {
      fence = fenceOpen(line);
    } else if (isFenceClose(line, fence)) {
      fence = null;
      // A callout can't stand inside a code block (it would be code): it waited for the fence.
      for (const callout of pending.splice(0)) out.push(...callout);
    }
  };

  let position = 0;
  for (const region of regions) {
    for (const line of ground.slice(position, region.start)) emit(line);
    const mineHunks = region.hunks.filter((hunk) => hunk.side === 'mine');
    const theirHunks = region.hunks.filter((hunk) => hunk.side === 'theirs');
    const mineLines = sideLines(ground, mine, mineHunks, region.start, region.end);
    const theirLines = sideLines(ground, theirs, theirHunks, region.start, region.end);
    if (theirHunks.length === 0 || sameLines(mineLines, theirLines)) {
      for (const line of mineLines) emit(line);
    } else if (mineHunks.length === 0) {
      for (const line of theirLines) emit(line);
    } else {
      conflicts++;
      for (const line of mineLines) emit(line);
      if (fence === null) {
        out.push(...conflictCallout(theirLines, mineLines.length, labels));
      } else {
        pending.push(conflictCallout(theirLines, null, labels));
      }
    }
    position = region.end;
  }
  for (const line of ground.slice(position)) emit(line);
  // An unclosed fence runs to the end of the text: the callouts go after it.
  for (const callout of pending) out.push(...callout);
  return { lines: out, conflicts };
}

/**
 * Merges three texts. Line endings: unchanged sides come back byte for byte; a real merge uses this
 * PC's most common line ending, BOM and final line break.
 */
export function mergeText(
  base: string | null,
  mine: string,
  theirs: string,
  labels: ConflictLabels,
): TextMergeResult {
  if (mine === theirs) return { text: mine, conflicts: 0 };
  if (base !== null && mine === base) return { text: theirs, conflicts: 0 };
  if (base !== null && theirs === base) return { text: mine, conflicts: 0 };
  const bom = mine.startsWith('﻿');
  const strip = (text: string): string => (text.startsWith('﻿') ? text.slice(1) : text);
  const mineLines = splitLines(strip(mine));
  const texts = (text: string): string[] => splitLines(strip(text)).map((line) => line.text);
  const finalNewline =
    mineLines.length === 0 || (mineLines[mineLines.length - 1]?.eol ?? '') !== '';
  const merged = mergeLines(
    base === null ? null : texts(base),
    mineLines.map((line) => line.text),
    texts(theirs),
    labels,
  );
  const eol = dominantEol(mineLines);
  let text = merged.lines.join(eol);
  if (finalNewline && merged.lines.length > 0) text += eol;
  return { text: (bom ? '﻿' : '') + text, conflicts: merged.conflicts };
}
