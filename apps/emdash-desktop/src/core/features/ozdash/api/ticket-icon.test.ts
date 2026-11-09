import { describe, expect, it } from 'vitest';
import { PRIORITY_PALETTE } from './priority-palette';
import {
  extractSvg,
  fallbackSprite,
  iconDataUrl,
  SPRITE_SIZE,
  validatePixelSvg,
} from './ticket-icon';

/** A real haiku answer (2026-11-09, "Add SCIM group sync to token server"). */
const GOOD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges"><rect x="2" y="2" width="2" height="2" fill="#ffd166"/><rect x="7" y="2" width="2" height="2" fill="#06d6a0"/><rect x="1" y="4" width="4" height="4" fill="#ffd166"/><rect x="2" y="10" width="11" height="1" fill="#4cc9f0"/><rect x="3" y="13" width="11" height="1" fill="#b388ff"/></svg>';

const svg = (inner: string, attributes = 'viewBox="0 0 16 16"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${inner}</svg>`;

describe('validatePixelSvg', () => {
  it('accepts pixel SVGs: rects, paths, groups, transforms, closing tags, whitespace', () => {
    expect(validatePixelSvg(GOOD)).toEqual({ success: true, svg: GOOD });
    const shapes = svg(
      '\n  <g fill="#ff0" transform="translate(1 0)">\n    <rect x="0" y="0" width="1" height="1"></rect>\n    <path d="M2 2h3v1H2z" fill="rgb(10, 200, 30)"/>\n  </g>\n',
      'viewBox=\'0,0,16,16\' width="32" height="32"'
    );
    expect(validatePixelSvg(shapes)).toMatchObject({ success: true });
  });

  it('adds a missing xmlns', () => {
    const result = validatePixelSvg(
      '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="2" height="2" fill="red"/></svg>'
    );
    expect(result).toEqual({
      success: true,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="1" y="1" width="2" height="2" fill="red"/></svg>',
    });
  });

  it.each([
    ['a script', svg('<script>alert(1)</script><rect x="0" y="0" width="1" height="1"/>')],
    ['an event handler', svg('<rect x="0" y="0" width="1" height="1" onload="alert(1)"/>')],
    ['href', svg('<rect x="0" y="0" width="1" height="1" href="https://x"/>')],
    ['xlink:href', svg('<rect x="0" y="0" width="1" height="1" xlink:href="#a"/>')],
    ['<use>', svg('<use href="#a"/>')],
    ['<image>', svg('<image href="data:image/png;base64,AAAA"/>')],
    ['a style attribute', svg('<rect x="0" y="0" width="1" height="1" style="fill:url(#g)"/>')],
    [
      'a <style> element',
      svg('<style>rect{fill:url(https://x)}</style><rect x="0" y="0" width="1" height="1"/>'),
    ],
    ['fill url()', svg('<rect x="0" y="0" width="1" height="1" fill="url(#g)"/>')],
    [
      'javascript in transform',
      svg('<rect x="0" y="0" width="1" height="1" transform="javascript:x"/>'),
    ],
    ['an entity', svg('<rect x="0" y="0" width="1" height="1" fill="&#x72;ed"/>')],
    ['text content', svg('hello<rect x="0" y="0" width="1" height="1"/>')],
    ['a comment', svg('<!-- hi --><rect x="0" y="0" width="1" height="1"/>')],
    ['a doctype', `<!DOCTYPE svg>${svg('<rect x="0" y="0" width="1" height="1"/>')}`],
    ['a wrong viewBox', svg('<rect x="0" y="0" width="1" height="1"/>', 'viewBox="0 0 32 32"')],
    ['no viewBox', svg('<rect x="0" y="0" width="1" height="1"/>', 'width="16"')],
    ['a nested svg', svg(svg('<rect x="0" y="0" width="1" height="1"/>'))],
    ['no shapes', svg('<g></g>')],
    [
      'an unclosed tag',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><g><rect x="0" y="0" width="1" height="1"/></svg>',
    ],
    ['two roots', `${GOOD}${GOOD}`],
    [
      'a wrong namespace',
      '<svg xmlns="http://evil" viewBox="0 0 16 16"><rect x="0" y="0" width="1" height="1"/></svg>',
    ],
    ['oversize', svg('<rect x="0" y="0" width="1" height="1" fill="#ffffff"/>'.repeat(200))],
  ])('rejects %s', (_name, input) => {
    expect(validatePixelSvg(input).success).toBe(false);
  });
});

describe('extractSvg', () => {
  it('drops fences and text around the SVG', () => {
    expect(extractSvg('Here you go:\n```svg\n' + GOOD + '\n```\nEnjoy!')).toBe(GOOD);
    expect(extractSvg('<?xml version="1.0"?>\n' + GOOD)).toBe(GOOD);
    expect(extractSvg('Sorry, I cannot.')).toBeNull();
  });

  it('makes a data URL', () => {
    expect(iconDataUrl('<svg a="#"/>')).toBe(
      'data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22%23%22%2F%3E'
    );
  });
});

describe('fallbackSprite', () => {
  it('is the same for the same id, and different for different ids', () => {
    expect(fallbackSprite('123', 2)).toEqual(fallbackSprite('123', 2));
    expect(fallbackSprite('123', 2)).not.toEqual(fallbackSprite('124', 2));
  });

  it('keeps the shape when only the priority changes, and uses its color', () => {
    const shape = (priority: number | null) =>
      fallbackSprite('42', priority).map(({ x, y }) => `${x},${y}`);
    expect(shape(1)).toEqual(shape(4));
    expect(fallbackSprite('42', 1)).not.toEqual(fallbackSprite('42', 4));
    expect(fallbackSprite('42', null)).toEqual(fallbackSprite('42', 3));
    expect(PRIORITY_PALETTE[1].accent).toMatch(/^#/);
  });

  it('is mirror-symmetric, inside 8x8, with two eyes', () => {
    for (const id of ['1', '7', '99', 'abc']) {
      const pixels = fallbackSprite(id, 3);
      const at = new Map(pixels.map((pixel) => [`${pixel.x},${pixel.y}`, pixel.fill]));
      for (const { x, y, fill } of pixels) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(SPRITE_SIZE);
        expect(y).toBeLessThan(SPRITE_SIZE);
        expect(at.get(`${SPRITE_SIZE - 1 - x},${y}`)).toBe(fill);
      }
      expect(at.get('2,3')).toBe('#1a1a2e');
      expect(at.get('5,3')).toBe('#1a1a2e');
      expect(pixels.length).toBeGreaterThan(16);
    }
  });
});
