import { describe, expect, it } from 'vitest';
import {
  CARD_TINT,
  CHIP_TINT,
  contrastRatio,
  mixHex,
  PRIORITY_PALETTE,
  priorityColor,
} from './priority-palette';

// The dark theme (packages/theme, `.emdark`), as sRGB hex.
const BACKGROUND = '#111111';
const FOREGROUND = '#E9E9E9';
const MUTED = '#B8B7B7';
const PASSIVE = '#929091';

describe('priority palette', () => {
  it('maps priorities to colors; missing is P3, out of range is clamped', () => {
    expect(priorityColor(1).name).toBe('Rose quartz');
    expect(priorityColor(null)).toBe(PRIORITY_PALETTE[3]);
    expect(priorityColor(9)).toBe(PRIORITY_PALETTE[4]);
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(mixHex('#FFFFFF', 50, '#000000')).toBe('#808080');
  });

  it.each([1, 2, 3, 4] as const)('P%i meets WCAG AA on the dark theme', (priority) => {
    const { accent } = PRIORITY_PALETTE[priority];
    const card = mixHex(accent, CARD_TINT, BACKGROUND);
    const chip = mixHex(accent, CHIP_TINT, BACKGROUND);
    const ratios = {
      text: contrastRatio(FOREGROUND, card),
      muted: contrastRatio(MUTED, card),
      passive: contrastRatio(PASSIVE, card),
      chipText: contrastRatio(FOREGROUND, chip),
      stripe: contrastRatio(accent, card),
    };
    if (process.env.OZDASH_PRINT_PALETTE) console.log(`P${priority} ${accent}`, ratios);
    expect(ratios.text).toBeGreaterThanOrEqual(4.5);
    expect(ratios.muted).toBeGreaterThanOrEqual(4.5);
    expect(ratios.passive).toBeGreaterThanOrEqual(4.5);
    expect(ratios.chipText).toBeGreaterThanOrEqual(4.5);
    expect(ratios.stripe).toBeGreaterThanOrEqual(3);
  });
});
