import type { CanvasPalette } from '@/domain/editors/lib/canvas-palette';
import { WEAPON_COLORS } from '@/shared/lib/starsector';

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

export function weaponSlotColor(type: string): string {
  return WEAPON_COLORS[type.toUpperCase() as keyof typeof WEAPON_COLORS] ?? '#9ca3af';
}

export function launchBayPortStyle(alpha: number, hovered = false, accent = false) {
  return {
    alpha,
    color: weaponSlotColor('LAUNCH_BAY'),
    radius: 10,
    centerRadius: accent ? 4.5 : 2.2,
    width: hovered || accent ? 1.8 : 1.1,
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

export function weaponSlotStyle(type: string, alpha: number) {
  return { alpha, color: weaponSlotColor(type), outlineWidth: 2.2, arcWidth: 2, facingColor: '#d8d8d8', facingWidth: 2, centerRadius: 5 };
}
