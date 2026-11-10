// Fork (ozimakov-st): ticket priority colors for the Tickets board and the ticket panel.
//
// Design: not a traffic light. The four accents walk one calm hue path, from warm to
// cool and from more to less color: P1 rose quartz (pink) -> P2 orchid (violet) ->
// P3 periwinkle (blue) -> P4 slate (grey-blue). All are soft and a bit desaturated,
// so they sit well next to the OZdash emerald accent (#34D399, which stays the "app"
// color and is not used for priority) on the dark background.
//
// P0 is a flash ticket (urgent, short work): "electric gold", a warm amber that is not
// a traffic-light red. Flash cards also get a soft gold glow (priorityCardStyle) and a
// lightning chip instead of the plain P-chip.
//
// Use: the accent is only a non-text color (card stripe, chip border, tint). Text
// stays in the theme's foreground colors on a lightly tinted background:
//   card background = 10% accent mixed into the background
//   chip background = 24% accent mixed into the background
//
// Contrast on the dark theme (background #111111, foreground #E9E9E9, muted #B8B7B7,
// passive #929091), measured with WCAG 2.x relative luminance (see priority-palette.test.ts):
//   P0 #F5C451  card: text 12.9, muted 7.8, passive 4.9 | chip text 8.9  | stripe vs card 9.6
//               (the chip's gold lightning icon vs the chip: 6.6)
//   P1 #EBA6C0  card: text 13.1, muted 8.0, passive 5.0 | chip text 9.5  | stripe vs card 8.2
//   P2 #C3A6F0  card: text 13.2, muted 8.0, passive 5.1 | chip text 9.7  | stripe vs card 7.7
//   P3 #93B4EE  card: text 13.3, muted 8.1, passive 5.1 | chip text 9.7  | stripe vs card 7.7
//   P4 #9CA6B5  card: text 13.4, muted 8.2, passive 5.1 | chip text 10.2 | stripe vs card 6.6
// Every text pair is >= 4.5:1 (WCAG AA body text); every stripe is >= 3:1 (non-text).
import type { CSSProperties } from 'react';
import { effectivePriority, isFlashPriority } from './tickets';

export type PriorityColor = { name: string; accent: string };

export type PaletteKey = 0 | 1 | 2 | 3 | 4;

export const PRIORITY_PALETTE: Readonly<Record<PaletteKey, PriorityColor>> = {
  0: { name: 'Flash (electric gold)', accent: '#F5C451' },
  1: { name: 'Rose quartz', accent: '#EBA6C0' },
  2: { name: 'Orchid', accent: '#C3A6F0' },
  3: { name: 'Periwinkle', accent: '#93B4EE' },
  4: { name: 'Slate', accent: '#9CA6B5' },
};

/** How much of the accent goes into the card and chip backgrounds (percent). */
export const CARD_TINT = 10;
export const CHIP_TINT = 24;

/** The color of a priority (missing = P3; 0 = flash). */
export function priorityColor(priority: number | null): PriorityColor {
  return PRIORITY_PALETTE[effectivePriority(priority) as PaletteKey];
}

const mixInto = (accent: string, percent: number, base: string) =>
  `color-mix(in srgb, ${accent} ${percent}%, ${base})`;

/** A flash ticket's soft gold glow (a box shadow; not a text color). */
export function flashGlow(accent = PRIORITY_PALETTE[0].accent): string {
  return `0 0 0 1px ${mixInto(accent, 35, 'transparent')}, 0 0 14px -4px ${mixInto(accent, 70, 'transparent')}`;
}

/**
 * Card: tinted background, a priority stripe on the left, a tinted border. A flash
 * ticket (P0) gets a stronger gold border and a soft glow.
 */
export function priorityCardStyle(priority: number | null): CSSProperties {
  const { accent } = priorityColor(priority);
  const flash = isFlashPriority(priority);
  return {
    backgroundColor: mixInto(accent, CARD_TINT, 'var(--color-background)'),
    borderColor: mixInto(accent, flash ? 55 : 30, 'var(--color-border)'),
    borderLeftColor: accent,
    ...(flash && { boxShadow: flashGlow(accent) }),
  };
}

/**
 * P-chip: tinted background and an accent border; the text keeps the foreground color.
 * A flash chip also glows a little.
 */
export function priorityChipStyle(priority: number | null): CSSProperties {
  const { accent } = priorityColor(priority);
  return {
    backgroundColor: mixInto(accent, CHIP_TINT, 'var(--color-background)'),
    borderColor: mixInto(accent, 60, 'transparent'),
    ...(isFlashPriority(priority) && {
      boxShadow: `0 0 8px -2px ${mixInto(accent, 70, 'transparent')}`,
    }),
  };
}

/** A Parked / Archive row of a flash ticket: a light gold tint and a gold bar on the left. */
export function flashRowStyle(): CSSProperties {
  const { accent } = PRIORITY_PALETTE[0];
  return {
    backgroundColor: mixInto(accent, CARD_TINT, 'var(--color-background)'),
    boxShadow: `inset 2px 0 0 ${accent}`,
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
