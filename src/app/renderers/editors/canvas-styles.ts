import type { CanvasPalette } from '@/domain/editors/lib/canvas-palette';

export interface OutlineStyle {
  color: string;
  outline: string;
  width: number;
  outlineWidth: number;
}

export interface PointStyle {
  color: string;
  outline: string;
  radius: number;
  width: number;
}

export interface MarkerStyle extends OutlineStyle {
  radius: number;
}

export function outlineStyle(palette: CanvasPalette, width: number, color = palette.marker): OutlineStyle {
  return { color, outline: palette.outline, width, outlineWidth: width + 1 };
}

export function controlPointStyle(palette: CanvasPalette, selected: boolean, hovered = false, radius = 5): PointStyle {
  return {
    color: selected || hovered ? palette.highlight : palette.marker,
    outline: palette.outline,
    radius: selected ? radius + 2 : hovered ? radius + 1 : radius,
    width: 1,
  };
}

export function centerMarkerStyle(palette: CanvasPalette, selected: boolean, hovered = false): MarkerStyle {
  return {
    ...outlineStyle(palette, selected ? 3 : 2, selected || hovered ? palette.highlight : palette.marker),
    radius: selected || hovered ? 16 : 13,
  };
}

export function barrelStyle(palette: CanvasPalette, selected: boolean, hovered = false, mirrored = false) {
  return {
    alpha: selected || hovered || mirrored ? 0.8 : 0.5,
    line: outlineStyle(palette, 2, selected || hovered ? palette.highlight : palette.marker),
    control: controlPointStyle(palette, selected, hovered),
    label: { color: palette.marker, outline: palette.outline, width: 1, alpha: 1 },
  };
}
