import type { SaveEdit } from './write-commit.types';
import type { SpecSave } from './spec-editor.types';
import type { TextSave, TextTranscode } from './file-editor.types';
import type { CsvSave } from './table-save.types';
import type { SaveJointEditPayload } from './joint-edit.types';
import type { ModInfoSave, IndexedConfigSave, IndexedConfigDelete } from './config-entity.types';
import type { JsonFileSave, JsonFileDelete } from './json-file.types';
import type { JsonSourceRestore } from './json-recovery.types';
import type { MiscConfigWrite, MiscConfigDelete } from './misc-config.types';
import type { FileReplay } from './file-history.types';
import type { SourceRefresh } from './project-session.types';

export type SaveAction =
  | { kind: 'save_editor_spec'; input: SpecSave }
  | { kind: 'save_text_file'; input: TextSave }
  | { kind: 'transcode_file_to_utf8'; input: TextTranscode }
  | { kind: 'save_csv_patch'; input: CsvSave }
  | { kind: 'save_joint_edit'; input: SaveJointEditPayload }
  | { kind: 'save_mod_info'; input: ModInfoSave }
  | { kind: 'save_indexed_config_entity' | 'create_indexed_config_entity'; input: IndexedConfigSave }
  | { kind: 'delete_indexed_config_entity'; input: IndexedConfigDelete }
  | { kind: 'save_variant_entity' | 'create_variant_entity' | 'save_skin_entity' | 'create_skin_entity'; input: JsonFileSave }
  | { kind: 'delete_variant_entity' | 'delete_skin_entity'; input: JsonFileDelete }
  | { kind: 'recreate_json_sources'; input: JsonSourceRestore }
  | { kind: 'save_misc_config'; input: MiscConfigWrite }
  | { kind: 'delete_misc_config'; input: MiscConfigDelete }
  | { kind: 'apply_file_change_set'; input: FileReplay }
  | { kind: 'refresh_project_sources'; input: SourceRefresh };

export interface SaveRequest {
  id: string;
  edits: SaveEdit[];
  action: SaveAction;
}
