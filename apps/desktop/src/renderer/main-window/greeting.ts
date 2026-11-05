/**
 * TODAY-01 (09 §4): the greeting's part of the day. D-107: "evening" lasts until 04:00, so a late
 * night isn't greeted with "Good morning" just after midnight.
 */
export function dayPart(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 4) return 'evening';
  if (hour < 12) return 'morning';
  return hour < 18 ? 'afternoon' : 'evening';
}
