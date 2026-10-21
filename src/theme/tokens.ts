import { Platform } from 'react-native';

export type Scheme = 'light' | 'dark';

const gray = {
  0: '#FFFFFF',
  50: '#F9FAFB',
  100: '#F2F3F5',
  200: '#E5E6E9',
  300: '#D2D4D8',
  400: '#9EA2A8',
  600: '#50545B',
  700: '#3C4046',
  800: '#25282D',
  850: '#1C1E22',
  900: '#15171B',
  950: '#0C0D10',
};

const blue = {
  100: '#D9EAFF',
  400: '#5FA1F3',
  600: '#0369E1',
  700: '#0054CD',
  900: '#0E326D',
};

const red = {
  100: '#FDE2E1',
  400: '#F66D67',
  500: '#EF4244',
  600: '#DD1F24',
  700: '#B91C1E',
  900: '#5F1A19',
};

const green = { 400: '#52CD86', 700: '#0B7643' };
const amber = { 400: '#F7B83D', 700: '#975800' };

export type Colors = {
  bg: string;
  surface: string;
  surfacePressed: string;
  surfaceSelected: string;
  field: string;
  fieldPressed: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textDisabled: string;
  accent: string;
  accentPressed: string;
  onAccent: string;
  danger: string;
  dangerPressed: string;
  focusRing: string;
  selection: string;
  toneAccentFg: string;
  toneSuccessFg: string;
  toneWarningFg: string;
  toneDangerBg: string;
  toneDangerFg: string;
};

export const colors: Record<Scheme, Colors> = {
  light: {
    bg: gray[50],
    surface: gray[0],
    surfacePressed: gray[200],
    surfaceSelected: blue[100],
    field: gray[100],
    fieldPressed: gray[200],
    border: gray[200],
    borderStrong: gray[300],
    text: gray[900],
    textMuted: gray[600],
    textDisabled: gray[400],
    accent: blue[600],
    accentPressed: blue[700],
    onAccent: gray[0],
    danger: red[600],
    dangerPressed: red[700],
    focusRing: blue[600],
    selection: blue[100],
    toneAccentFg: blue[700],
    toneSuccessFg: green[700],
    toneWarningFg: amber[700],
    toneDangerBg: red[100],
    toneDangerFg: red[700],
  },
  dark: {
    bg: gray[950],
    surface: gray[900],
    surfacePressed: gray[800],
    surfaceSelected: blue[900],
    field: gray[850],
    fieldPressed: gray[800],
    border: gray[800],
    borderStrong: gray[700],
    text: gray[50],
    textMuted: gray[400],
    textDisabled: gray[600],
    accent: blue[600],
    accentPressed: blue[700],
    onAccent: gray[0],
    danger: red[500],
    dangerPressed: red[400],
    focusRing: blue[400],
    selection: blue[900],
    toneAccentFg: blue[400],
    toneSuccessFg: green[400],
    toneWarningFg: amber[400],
    toneDangerBg: red[900],
    toneDangerFg: red[400],
  },
};

export const font = {
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }),
};

// The desktop type scale one step up: touch screens are read at arm's length
// and system body text is 16–17 pt, so desktop's 14 px body would look small.
export const text = {
  sm: { fontSize: 13, lineHeight: 18 },
  rowMeta: { fontSize: 14, lineHeight: 19 },
  md: { fontSize: 16, lineHeight: 22, letterSpacing: -0.12 },
  rowTitle: { fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  lg: { fontSize: 18, lineHeight: 24, letterSpacing: -0.2 },
  xl: { fontSize: 28, lineHeight: 34, letterSpacing: -0.48 },
};

export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} satisfies Record<string, '400' | '500' | '600' | '700'>;

export const space = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
};

export const radius = {
  xs: 4,
  md: 6,
  lg: 10,
  full: 9999,
  control: 9999,
  field: 10,
};

export const control = {
  heightSm: 36,
  heightMd: 44,
  heightLg: 52,
  paddingSm: 12,
  paddingMd: 16,
  paddingLg: 20,
  minHit: 44,
};

export const icon = {
  sm: 14,
  md: 20,
  lg: 24,
  stroke: 1.5,
};

export const size = {
  borderWidth: 1,
  focusRingWidth: 2,
  dotSize: 6,
  meterHeight: 6,
  checkbox: 20,
  measureNarrow: 448,
};

export const duration = {
  fast: 150,
};
