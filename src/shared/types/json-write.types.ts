export interface JsonSourceConfirmation {
  path: string;
  sourceFingerprint: string;
}

export interface JsonWriteOptions {
  keepFilename?: boolean;
  preserveOriginalJson?: boolean;
  confirmedSources?: JsonSourceConfirmation[];
  /** Mod-relative JSON paths this write adds to the `mod_info.json` replace list in the same changeset. */
  replacePaths?: string[];
}
