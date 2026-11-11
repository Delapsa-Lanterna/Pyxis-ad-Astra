import type { Ref } from 'vue';
import type { TextFile } from './use-text-file';
import type { TextFileOpen, TextFileOpenResult } from '@/shared/types';

export interface TextFiles {
  documents: readonly TextFile[];
  active: Readonly<Ref<TextFile | null>>;
  activate: (path: string) => void;
  isDisposed: () => boolean;
  openFiles: (files: TextFileOpen[]) => Promise<TextFileOpenResult[]>;
  openSnapshot: (path: string, source: string) => Promise<TextFile | null>;
}
