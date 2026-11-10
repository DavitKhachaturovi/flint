/**
 * A line diff (Myers' O(ND) algorithm) for Google Drive sync's three-way merges (SYNC-01, D-161,
 * docs/04 §7). Pure: arrays of strings in, the hunks that turn one into the other out.
 */

/** Lines `[aStart, aEnd)` of the old text were replaced by lines `[bStart, bEnd)` of the new one. */
export interface Hunk {
  readonly aStart: number;
  readonly aEnd: number;
  readonly bStart: number;
  readonly bEnd: number;
}

/**
 * Above this many differences the diff gives up on finding the shortest script and calls the whole
 * middle one change: still correct (a merge then keeps both versions of that part), never slow.
 */
const MAX_DIFFERENCES = 4000;

/** The pairs of equal lines that Myers' shortest edit script keeps, in order. */
function commonPairs(a: readonly number[], b: readonly number[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_DIFFERENCES);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = false;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && (next[offset + k - 1] ?? 0) < (next[offset + k + 1] ?? 0))
          ? (next[offset + k + 1] ?? 0)
          : (next[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        v = next;
        trace.push(v);
        found = true;
        break outer;
      }
    }
    v = next;
  }
  if (!found) return [];
  // Walk the trace back from the end, collecting the diagonal (equal) moves.
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
    const previous = trace[d] as Int32Array;
    const k = x - y;
    const down =
      k === -d || (k !== d && (previous[offset + k - 1] ?? 0) < (previous[offset + k + 1] ?? 0));
    const previousK = down ? k + 1 : k - 1;
    const previousX = previous[offset + previousK] ?? 0;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    if (d > 0) {
      x = previousX;
      y = previousY;
    }
  }
  while (x > 0 && y > 0 && a[x - 1] === b[y - 1]) {
    x--;
    y--;
    pairs.push([x, y]);
  }
  return pairs.reverse();
}

/** The hunks that turn `a` into `b`, in order; equal inputs give none. */
export function diffLines(a: readonly string[], b: readonly string[]): Hunk[] {
  // Lines as numbers, so the inner loop compares integers.
  const ids = new Map<string, number>();
  const id = (line: string): number => {
    let value = ids.get(line);
    if (value === undefined) {
      value = ids.size;
      ids.set(line, value);
    }
    return value;
  };
  const left = a.map(id);
  const right = b.map(id);
  // The common start and end cost nothing and are the usual case (one paragraph changed).
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let endA = left.length;
  let endB = right.length;
  while (endA > start && endB > start && left[endA - 1] === right[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = commonPairs(left.slice(start, endA), right.slice(start, endB)).map(
    ([x, y]): [number, number] => [x + start, y + start],
  );
  const hunks: Hunk[] = [];
  let x = start;
  let y = start;
  for (const [px, py] of [...middle, [endA, endB] as [number, number]]) {
    if (px > x || py > y) hunks.push({ aStart: x, aEnd: px, bStart: y, bEnd: py });
    x = px + 1;
    y = py + 1;
  }
  return hunks;
}
