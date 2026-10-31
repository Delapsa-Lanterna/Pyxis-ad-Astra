export interface JsonSourceConfirmation {
  path: string;
  sourceFingerprint: string;
}

export interface JsonWriteOptions {
  preserveOriginalJson?: boolean;
  confirmedSources?: JsonSourceConfirmation[];
}
