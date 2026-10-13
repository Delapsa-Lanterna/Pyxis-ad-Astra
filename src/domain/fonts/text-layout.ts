import type { BitmapFont, BitmapPlacement, TextBounds, TextLayout, TextRun } from './font.types';

const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
const opening = new Set(Array.from('([{（［｛〈《「『【〔〖〘〚“‘'));
const closing = new Set(Array.from(')]}）］｝〉》」』】〕〗〙〛”’，。、；：！？,.!?:;%％'));
const wordCharacter = /^(?:\p{Script=Latin}|\p{M}|\p{N}|_)+$/u;

export function textGraphemes(text: string): string[] {
  return [...graphemes.segment(text)].map((entry) => entry.segment);
}

function coloredGraphemes(runs: readonly TextRun[]) {
  const text = runs.map((run) => run.text).join('');
  let runIndex = 0,
    runEnd = runs[0]?.text.length ?? 0;
  return [...graphemes.segment(text)].map(({ segment, index }) => {
    while (index >= runEnd) runEnd += runs[++runIndex]!.text.length;
    return { character: segment, color: runs[runIndex]!.color };
  });
}

function textBounds(left: number, top: number, right: number, bottom: number): TextBounds {
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function bitmapInkBounds(font: BitmapFont, placements: readonly BitmapPlacement[]): TextBounds {
  const visible = placements.filter((item) => !/^\s+$/u.test(item.character));
  if (!visible.length) return textBounds(0, 0, 0, font.lineHeight);
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const item of visible) {
    const glyph = item.glyph;
    left = Math.min(left, item.x + (glyph?.xoffset ?? 1));
    top = Math.min(top, item.y + (glyph?.yoffset ?? 2));
    right = Math.max(right, item.x + (glyph ? glyph.xoffset + glyph.width : item.advance - 2));
    bottom = Math.max(bottom, item.y + (glyph ? glyph.yoffset + glyph.height : font.lineHeight - 2));
  }
  return textBounds(left, top, right, bottom);
}

export function layoutText(font: BitmapFont, runs: readonly TextRun[], maxWidth = Infinity): TextLayout {
  const characters = coloredGraphemes(runs).map(({ character, color }) => {
    const id = Array.from(character).length === 1 ? character.codePointAt(0)! : null;
    const glyph = id === null ? null : (font.glyphs.get(id) ?? null);
    return {
      character,
      color,
      glyph,
      advance: character === '\t' ? font.glyphs.get(32)!.xadvance * 4 : (glyph?.xadvance ?? font.lineHeight),
    };
  });
  const placements: BitmapPlacement[] = [],
    missing = new Set<string>();
  let x = 0,
    y = 0,
    advanceWidth = 0,
    previous: number | null = null;
  const kerning = (first: number | null, second: number | null) =>
    first === null || second === null ? 0 : (font.kernings.get(first + ':' + second) ?? 0);
  function newLine() {
    advanceWidth = Math.max(advanceWidth, x);
    x = 0;
    y += font.lineHeight;
    previous = null;
  }
  for (let index = 0; index < characters.length;) {
    const first = characters[index]!;
    if (/^[\r\n]+$/.test(first.character)) {
      newLine();
      index++;
      continue;
    }
    let end = index + 1;
    while (end < characters.length) {
      const left = characters[end - 1]!.character,
        right = characters[end]!.character;
      if (/^[\r\n]+$/.test(right)) break;
      if (!(opening.has(left) || closing.has(right) || (wordCharacter.test(left) && wordCharacter.test(right)))) break;
      end++;
    }
    let tokenWidth = 0,
      last: number | null = null;
    for (let cursor = index; cursor < end; cursor++) {
      const item = characters[cursor]!;
      tokenWidth += kerning(last, item.glyph?.id ?? null) + item.advance;
      last = item.glyph?.id ?? null;
    }
    if (x > 0 && tokenWidth <= maxWidth && x + kerning(previous, first.glyph?.id ?? null) + tokenWidth > maxWidth) newLine();
    for (; index < end; index++) {
      const item = characters[index]!;
      if (tokenWidth > maxWidth) {
        let unitEnd = index + 1,
          unitWidth = item.advance,
          unitLast = item.glyph?.id ?? null;
        while (unitEnd < end && (opening.has(characters[unitEnd - 1]!.character) || closing.has(characters[unitEnd]!.character))) {
          const next = characters[unitEnd]!;
          unitWidth += kerning(unitLast, next.glyph?.id ?? null) + next.advance;
          unitLast = next.glyph?.id ?? null;
          unitEnd++;
        }
        if (x > 0 && unitWidth <= maxWidth && x + kerning(previous, item.glyph?.id ?? null) + unitWidth > maxWidth) newLine();
      }
      let kern = kerning(previous, item.glyph?.id ?? null);
      if (x > 0 && x + kern + item.advance > maxWidth) {
        newLine();
        kern = 0;
      }
      x += kern;
      if (!item.glyph && !/^\s+$/u.test(item.character)) missing.add(item.character);
      placements.push({ ...item, x, y });
      x += item.advance;
      previous = item.glyph?.id ?? null;
    }
  }
  advanceWidth = Math.max(advanceWidth, x);
  const ink = bitmapInkBounds(font, placements);
  return {
    placements,
    advanceWidth,
    width: Math.max(advanceWidth, ink.right) - Math.min(0, ink.left),
    height: y + font.lineHeight,
    ink,
    missing: [...missing],
  };
}
