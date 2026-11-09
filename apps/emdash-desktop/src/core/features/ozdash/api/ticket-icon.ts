// Fork (ozimakov-st): ticket icons. A ticket may have `icon.svg` next to `ticket.md`: a
// 16x16 pixel-art SVG that OZdash generates (see node/ticket-icons.ts). Until it
// exists, the board shows a procedural "space invader" sprite made from the ticket id.
// Pure: used by the main process (validation) and the renderer (fallback sprite).
import { priorityColor } from './priority-palette';

export const ICON_FILE = 'icon.svg';
export const ICON_MAX_BYTES = 8 * 1024;
const SVG_NS = 'http://www.w3.org/2000/svg';

export type IconValidation = { success: true; svg: string } | { success: false; error: string };

/** The SVG in a model answer: code fences and text around it are dropped. Null when none. */
export function extractSvg(output: string): string | null {
  const start = output.indexOf('<svg');
  const end = output.lastIndexOf('</svg>');
  if (start < 0 || end < start) return null;
  return output.slice(start, end + '</svg>'.length);
}

const NUMBER = /^-?\d+(\.\d+)?(px)?$/;
const COLOR = /^(none|transparent|#[0-9a-f]{3,8}|rgba?\(\s*[\d.%\s,]+\)|[a-z]{3,20})$/i;
const PATH_DATA = /^[MmLlHhVvZzCcSsQqTtAa\d\s.,-]+$/;
const TRANSFORM = /^((translate|scale|rotate|matrix)\(\s*[-\d.\s,]+\)\s*)+$/;
const SHAPE_RENDERING = /^(auto|crispEdges|optimizeSpeed|geometricPrecision)$/;

/** Allowed attributes and how their values must look. */
const SHAPE_ATTRIBUTES: Record<string, RegExp> = {
  fill: COLOR,
  x: NUMBER,
  y: NUMBER,
  width: NUMBER,
  height: NUMBER,
  d: PATH_DATA,
  transform: TRANSFORM,
  'shape-rendering': SHAPE_RENDERING,
};
const ALLOWED: Record<string, Record<string, RegExp>> = {
  svg: {
    xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/,
    viewBox: /^\s*0[\s,]+0[\s,]+16[\s,]+16\s*$/,
    width: NUMBER,
    height: NUMBER,
    fill: COLOR,
    'shape-rendering': SHAPE_RENDERING,
  },
  g: { fill: COLOR, transform: TRANSFORM, 'shape-rendering': SHAPE_RENDERING },
  rect: SHAPE_ATTRIBUTES,
  path: SHAPE_ATTRIBUTES,
};

const TAG = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTRIBUTE = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Strict check of an icon SVG: only `<svg>` (viewBox 0 0 16 16), `<g>`, `<rect>` and
 * `<path>`, only fill / x / y / width / height / d / transform (plus xmlns, viewBox and
 * shape-rendering), no text, comments, scripts, links, styles or entities, at most 8 KB.
 * Returns the SVG with `xmlns` added when it was missing (needed for `<img>`).
 */
export function validatePixelSvg(input: string): IconValidation {
  const text = input.trim();
  if (new TextEncoder().encode(text).length > ICON_MAX_BYTES)
    return { success: false, error: 'larger than 8 KB' };
  const stack: string[] = [];
  let roots = 0;
  let shapes = 0;
  let hasXmlns = false;
  let index = 0;
  while (index < text.length) {
    const next = text.indexOf('<', index);
    const between = text.slice(index, next < 0 ? text.length : next);
    if (between.trim() !== '') return { success: false, error: 'text content is not allowed' };
    if (next < 0) break;
    TAG.lastIndex = next;
    const match = TAG.exec(text);
    if (!match) return { success: false, error: `unexpected markup at ${next}` };
    index = TAG.lastIndex;
    const [, closing, name, attributes, selfClosing] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
    ];
    const allowed = ALLOWED[name];
    if (!allowed) return { success: false, error: `<${name}> is not allowed` };
    if (closing) {
      if (attributes.trim() || selfClosing) return { success: false, error: 'bad closing tag' };
      if (stack.pop() !== name) return { success: false, error: `unbalanced </${name}>` };
      continue;
    }
    if (name === 'svg' ? stack.length > 0 : stack.length === 0)
      return { success: false, error: 'the root must be one <svg>' };
    if (name === 'svg') roots += 1;
    if (stack.length > 0 && stack[stack.length - 1] !== 'svg' && stack[stack.length - 1] !== 'g')
      return { success: false, error: `<${name}> inside <${stack[stack.length - 1]}>` };
    const seen = new Set<string>();
    for (const attribute of attributes.matchAll(ATTRIBUTE)) {
      const key = attribute[1]!;
      const value = attribute[2] ?? attribute[3] ?? '';
      const rule = allowed[key];
      if (!rule) return { success: false, error: `attribute ${key} on <${name}> is not allowed` };
      if (seen.has(key)) return { success: false, error: `duplicate attribute ${key}` };
      seen.add(key);
      if (!rule.test(value))
        return { success: false, error: `bad ${key} value on <${name}>: ${value.slice(0, 40)}` };
    }
    if (name === 'svg') {
      if (!seen.has('viewBox')) return { success: false, error: 'viewBox must be 0 0 16 16' };
      hasXmlns = seen.has('xmlns');
    }
    if (name === 'rect' || name === 'path') shapes += 1;
    if (!selfClosing) stack.push(name);
  }
  if (stack.length > 0) return { success: false, error: `<${stack[stack.length - 1]}> not closed` };
  if (roots !== 1) return { success: false, error: 'the root must be one <svg>' };
  if (shapes === 0) return { success: false, error: 'no shapes' };
  const svg = hasXmlns ? text : text.replace(/^<svg/, `<svg xmlns="${SVG_NS}"`);
  return { success: true, svg };
}

/** An `<img src>` for a validated icon. */
export function iconDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Fallback sprite: a symmetric 8x8 "space invader" from the ticket id.

export const SPRITE_SIZE = 8;
export type SpritePixel = { x: number; y: number; fill: string };

/** FNV-1a, 32 bit. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** mulberry32: a small seeded random number generator (0 <= n < 1). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a: string, b: string, weight: number): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16);
  const parts = [0, 1, 2].map((at) =>
    Math.round(channel(a, at) * weight + channel(b, at) * (1 - weight))
      .toString(16)
      .padStart(2, '0')
  );
  return `#${parts.join('')}`;
}

/** Friendly second colors; each sprite mixes one into its priority color. */
const SPRITE_HUES = ['#7CF0C8', '#FFC48A', '#8FD8FF', '#FFE58A', '#FF9EC4', '#B6A0FF'];
/** Chance that a cell of a row is filled (top to bottom): a rounded body. */
const ROW_DENSITY = [0.35, 0.55, 0.75, 0.8, 0.8, 0.7, 0.55, 0.4];
const EYE_ROW = 3;
const EYE_COLUMN = 2;

/**
 * A cute, symmetric 8x8 sprite for a ticket id, tinted by priority. The same id always
 * gives the same shape; the priority only changes the colors.
 */
export function fallbackSprite(ticketId: string, priority: number | null): SpritePixel[] {
  const random = seeded(hash(`ticket:${ticketId}`));
  const accent = priorityColor(priority).accent.toLowerCase();
  const hue = SPRITE_HUES[Math.floor(random() * SPRITE_HUES.length)]!;
  const body = mix(accent, hue, 0.6);
  const shade = mix(body, '#1a1a2e', 0.65);
  const light = mix(body, '#ffffff', 0.7);
  const eye = '#1a1a2e';
  const pixels: SpritePixel[] = [];
  const half = SPRITE_SIZE / 2;
  for (let y = 0; y < SPRITE_SIZE; y += 1) {
    for (let x = 0; x < half; x += 1) {
      const isEye = y === EYE_ROW && x === EYE_COLUMN;
      // The two middle columns of the middle rows are always filled: one connected body.
      const core = x === half - 1 && y >= 2 && y <= 5;
      const roll = random();
      const texture = random();
      if (!isEye && !core && roll >= ROW_DENSITY[y]!) continue;
      const fill = isEye
        ? eye
        : texture < 0.18
          ? shade
          : texture > 0.9 || (y === 1 && texture > 0.6)
            ? light
            : body;
      pixels.push({ x, y, fill }, { x: SPRITE_SIZE - 1 - x, y, fill });
    }
  }
  return pixels;
}
