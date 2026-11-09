// Fork (ozimakov-st): ticket priority colors for the Tickets board and the ticket panel.
//
// Design: not a traffic light. The four accents walk one calm hue path, from warm to
// cool and from more to less color: P1 rose quartz (pink) -> P2 orchid (violet) ->
// P3 periwinkle (blue) -> P4 slate (grey-blue). All are soft and a bit desaturated,
// so they sit well next to the OZdash emerald accent (#34D399, which stays the "app"
// color and is not used for priority) on the dark background.
//
// Use: the accent is only a non-text color (card stripe, chip border, tint). Text
// stays in the theme's foreground colors on a lightly tinted background:
//   card background = 10% accent mixed into the background
//   chip background = 24% accent mixed into the background
//
// Contrast on the dark theme (background #111111, foreground #E9E9E9, muted #B8B7B7,
// passive #929091), measured with WCAG 2.x relative luminance (see priority-palette.test.ts):
//   P1 #EBA6C0  card: text 13.1, muted 8.0, passive 5.0 | chip text 9.5  | stripe vs card 8.2
//   P2 #C3A6F0  card: text 13.2, muted 8.0, passive 5.1 | chip text 9.7  | stripe vs card 7.7
//   P3 #93B4EE  card: text 13.3, muted 8.1, passive 5.1 | chip text 9.7  | stripe vs card 7.7
//   P4 #9CA6B5  card: text 13.4, muted 8.2, passive 5.1 | chip text 10.2 | stripe vs card 6.6
// Every text pair is >= 4.5:1 (WCAG AA body text); every stripe is >= 3:1 (non-text).
import type { CSSProperties } from 'react';
import { effectivePriority } from './tickets';

export type PriorityColor = { name: string; accent: string };

export const PRIORITY_PALETTE: Readonly<Record<1 | 2 | 3 | 4, PriorityColor>> = {
  1: { name: 'Rose quartz', accent: '#EBA6C0' },
  2: { name: 'Orchid', accent: '#C3A6F0' },
  3: { name: 'Periwinkle', accent: '#93B4EE' },
  4: { name: 'Slate', accent: '#9CA6B5' },
};

/** How much of the accent goes into the card and chip backgrounds (percent). */
export const CARD_TINT = 10;
export const CHIP_TINT = 24;

/** The color of a priority (missing = P3). */
export function priorityColor(priority: number | null): PriorityColor {
  return PRIORITY_PALETTE[effectivePriority(priority) as 1 | 2 | 3 | 4];
}

const mixInto = (accent: string, percent: number, base: string) =>
  `color-mix(in srgb, ${accent} ${percent}%, ${base})`;

/** Card: tinted background, a priority stripe on the left, a tinted border. */
export function priorityCardStyle(priority: number | null): CSSProperties {
  const { accent } = priorityColor(priority);
  return {
    backgroundColor: mixInto(accent, CARD_TINT, 'var(--color-background)'),
    borderColor: mixInto(accent, 30, 'var(--color-border)'),
    borderLeftColor: accent,
  };
}

/** P-chip: tinted background and an accent border; the text keeps the foreground color. */
export function priorityChipStyle(priority: number | null): CSSProperties {
  const { accent } = priorityColor(priority);
  return {
    backgroundColor: mixInto(accent, CHIP_TINT, 'var(--color-background)'),
    borderColor: mixInto(accent, 60, 'transparent'),
  };
}

// WCAG 2.x contrast, for the test that keeps the numbers above honest.

function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as [number, number, number];
}

/** `color-mix(in srgb, a p%, b)` for opaque hex colors. */
export function mixHex(a: string, percent: number, b: string): string {
  const ca = channels(a);
  const cb = channels(b);
  const mixed = ca.map((value, index) =>
    Math.round((value * percent + cb[index]! * (100 - percent)) / 100)
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two opaque hex colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
