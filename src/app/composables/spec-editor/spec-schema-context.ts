import type { InjectionKey, Ref } from 'vue';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';

export const specSchemaContext: InjectionKey<Readonly<Ref<SchemaRuntimeContext | null>>> = Symbol('spec-schema-context');
