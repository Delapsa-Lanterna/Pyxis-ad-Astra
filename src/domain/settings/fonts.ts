export const DEFAULT_INTERFACE_FONT_FAMILY = "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif";

export const DEFAULT_FIELD_FONT_FAMILY = "'Cascadia Mono', Consolas, 'Courier New', 'Microsoft YaHei UI', 'Microsoft YaHei', monospace";

export const DEFAULT_TEXT_EDITOR_FONT_FAMILY =
  "'Cascadia Mono', Consolas, 'Courier New', 'Microsoft YaHei UI', 'Microsoft YaHei', monospace";

export const DEFAULT_CANVAS_EDITOR_FONT_FAMILY = 'sans-serif';

export function fontFamily(font: string | null, defaults: string): string {
  return font === null ? defaults : `"${font.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}", ${defaults}`;
}
