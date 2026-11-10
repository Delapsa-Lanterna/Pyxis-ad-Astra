export interface JsonWriteOptions {
  keepFilename?: boolean;
  preserveStructure?: boolean;
  /** Mod-relative JSON paths this write adds to the `mod_info.json` replace list in the same changeset. */
  replacePaths?: string[];
}
