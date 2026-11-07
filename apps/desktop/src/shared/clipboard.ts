/**
 * NAV-08, D-128: how a clipboard history item shows in the Clipboard section and its picker: one
 * line (the first that has text, its spaces collapsed), a short age, and at rest (contents hidden,
 * D-128 Q3) a placeholder bar as long as that line, so nothing of the text is drawn.
 */

/** The first line with text, spaces collapsed, at most `max` characters. */
export function clipPreview(text: string, max = 200): string {
  const line = text.split(/\r\n|\r|\n/).find((each) => each.trim() !== '') ?? '';
  const flat = line.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayStart = (ms: number): number => {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

/** "now", "4m", "2h" (today), "yesterday", then "7 Nov". */
export function clipAge(at: number, now: number): string {
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const today = dayStart(now);
  if (at >= today) return `${Math.floor(seconds / 3600)}h`;
  if (at >= dayStart(today - 1)) return 'yesterday';
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ''}`;
}

/** The placeholder bar's width (% of the room left of the kind and age): longer text, longer bar. */
export function clipBarWidth(text: string): number {
  const length = clipPreview(text).length;
  return Math.round(Math.min(78, Math.max(14, 10 + length * 1.1)));
}

/** "Text", "Link", "Code": what the row says at rest. */
export const CLIP_KIND_LABEL = { text: 'Text', link: 'Link', code: 'Code' } as const;
