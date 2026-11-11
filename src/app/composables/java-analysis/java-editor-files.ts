import type { Ref } from 'vue';
import type { TextContent, TextDocument } from '@/shared/runtime/text-document';
import type { TextFileOpen, TextFileOpenResult } from '@/shared/types';

type SourceSnapshot = { target: { path: string }; value: TextContent };
export interface JavaEditorFile {
  path: Readonly<Ref<string>>;
  readOnly: boolean;
  document: Pick<TextDocument, 'content' | 'state' | 'transaction' | 'waitForInput' | 'locate' | 'lightweight'>;
  session: { baselineSnapshot: Readonly<Ref<SourceSnapshot | null>>; pendingSnapshot: Readonly<Ref<SourceSnapshot | null>> };
}
export interface JavaEditorFiles {
  documents: readonly JavaEditorFile[];
  active: Readonly<Ref<JavaEditorFile | null>>;
  isDisposed: () => boolean;
  activate: (path: string) => void;
  openFiles: (files: TextFileOpen[]) => Promise<TextFileOpenResult[]>;
  openSnapshot: (path: string, source: string) => Promise<JavaEditorFile | null>;
}
