import type { InjectionKey, Ref } from 'vue';
import type { FieldEditorContext } from '@/domain/field-editor/field-editor-context';

export const specSchemaContext: InjectionKey<Readonly<Ref<FieldEditorContext | null>>> = Symbol('spec-schema-context');
