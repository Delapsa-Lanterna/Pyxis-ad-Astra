export const resourceSizes = [32, 128, 512] as const;

export function resourceImage(size: number, identity: string): string {
  const seed = Array.from(identity).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 7);
  const tiles = Array.from({ length: 64 }, (_, index) => {
    const color = ((seed + index * 2654435761) >>> 0).toString(16).slice(-6).padStart(6, '0');
    return `<rect x="${index % 8}" y="${Math.floor(index / 8)}" width="1" height="1" fill="#${color}"/>`;
  }).join('');
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 8 8">${tiles}</svg>`)
  );
}
