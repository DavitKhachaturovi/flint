/**
 * D-107: tips shown the first few times only (then never again), counted on this computer in the
 * window's local storage: a convenience, so losing it only shows a tip again.
 */
const KEY = 'flint.tips';

/** Whether the tip `name` is still due (shown fewer than `times` times); counts this showing. */
export function tipDue(name: string, times: number): boolean {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as unknown;
    const counts =
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const seen = typeof counts[name] === 'number' ? counts[name] : 0;
    if (seen >= times) return false;
    window.localStorage.setItem(KEY, JSON.stringify({ ...counts, [name]: seen + 1 }));
    return true;
  } catch {
    return false;
  }
}
