import type { EntityFileLocation, FileVersion } from './project-identity.types';
import type { RowData } from './json.types';

export interface JsonSourceLayer {
  source: EntityFileLocation;
  version: FileVersion;
  data: RowData;
  replace: boolean;
}
export interface JsonComposition {
  layers: JsonSourceLayer[];
  excluded: string[];
  replace: boolean;
}
