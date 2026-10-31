export interface JsonSourceConfirmation {
  path: string;
  sourceFingerprint: string;
}

export interface JsonWriteOptions {
  keepFilename?: boolean;
  preserveOriginalJson?: boolean;
  confirmedSources?: JsonSourceConfirmation[];
}
