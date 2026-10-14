export const DEFAULT_FONT_FAMILY = "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif";

export function generalFontFamily(font: string | null): string {
  return font === null ? DEFAULT_FONT_FAMILY : `"${font.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}", ${DEFAULT_FONT_FAMILY}`;
}
