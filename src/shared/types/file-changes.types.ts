export interface FileSnapshot {
  relPath: string;
  text: string | null;
  dataBase64: string | null;
}

export type FileChangeKind = 'file' | 'directory';

export interface FileChangeRecord {
  kind: FileChangeKind;
  beforePath: string;
  afterPath: string;
  beforeExists: boolean;
  beforeText: string | null;
  beforeDataBase64: string | null;
  beforeFiles: FileSnapshot[];
  afterExists: boolean;
  afterText: string | null;
  afterDataBase64: string | null;
  afterFiles: FileSnapshot[];
}

export interface CommittedFileChange extends Pick<
  FileChangeRecord,
  'kind' | 'beforePath' | 'afterPath' | 'beforeExists' | 'afterExists' | 'afterText'
> {
  beforeBinary: boolean;
  afterBinary: boolean;
  beforeFiles: string[];
  afterFiles: { relPath: string; text: string | null; binary: boolean }[];
}

export type FileChangeReplayDirection = 'undo' | 'redo';
