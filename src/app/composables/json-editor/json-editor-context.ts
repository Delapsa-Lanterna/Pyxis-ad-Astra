import type { Ref } from 'vue';
import type { ProjectManifest } from '@/shared/types';

export interface JsonEditorContext {
  active: Readonly<Ref<boolean>>;
  modRoot: Readonly<Ref<string | null>>;
  sessionId: Readonly<Ref<string | null>>;
  manifest: Readonly<Ref<ProjectManifest | null>>;
}
