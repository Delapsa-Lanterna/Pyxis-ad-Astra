export type FontId =
  | 'insignia15LTaa'
  | 'insignia21LTaa'
  | 'orbitron12condensed'
  | 'orbitron20aa'
  | 'orbitron20aabold'
  | 'orbitron24aa'
  | 'orbitron24aabold'
  | 'victor10'
  | 'victor14';

export interface OriginalFontPage {
  id: number;
  path: string;
  dataUrl: string;
}

export type OriginalFontResult =
  | { status: 'unavailable' }
  | { status: 'available'; root: string; fontId: FontId; path: string; definition: string; pages: OriginalFontPage[] };

export interface QueryOriginalFontPayload {
  sessionId: string;
  starsectorRoot: string | null;
  fontDirectory: string | null;
  fontId: FontId;
}
