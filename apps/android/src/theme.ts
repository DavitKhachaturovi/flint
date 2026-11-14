/**
 * Flint's design tokens for the phone (docs/design/tokens.css, docs/09 §12): the same values under
 * the same names. Components use these, never raw colours.
 */
export const color = {
  groundWindow: '#0D0E10',
  groundSidebar: '#111214',
  groundCard: '#151619',
  groundFloat: '#1B1D20',
  groundTile: '#1F2124',
  groundWell: '#0E0F11',
  edgeCard: '#232529',
  edgeFloat: '#2A2C30',
  edgeChip: '#2C2E33',
  edgeDivider: '#1C1E21',
  textHighlight: '#FFFFFF',
  textPrimary: '#ECEDEE',
  textBody: '#E3E4E6',
  textHeadingSoft: '#B9BDC4',
  textSecondary: '#A4A7AB',
  textMuted: '#8E9196',
  textFaint: '#75787D',
  accent: '#9AA0AB',
  strongBg: '#ECEDEE',
  strongFg: '#0E0F11',
} as const;

export const radius = {
  check: 7,
  tile: 8,
  button: 10,
  row: 12,
  card: 18,
  popup: 22,
} as const;

/** docs/09 §12: phone sizes. */
export const size = {
  body: 16,
  title: 28,
  greeting: 30,
  label: 12,
  meta: 12.5,
} as const;
