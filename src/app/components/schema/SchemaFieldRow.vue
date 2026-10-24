<template>
  <FieldRow :path="path ?? field.key" :layout="schemaCollection(field) ? 'group' : 'row'">
    <template #label>
      <div class="ui-control-row">
        <slot name="label">
          <FieldLabel
            :label="field.label"
            :field-key="field.key"
            :path="path ?? field.key"
            :required="field.required"
            :description="settings.expandFieldDescriptions ? undefined : field.description"
          />
        </slot>
        <slot v-if="schemaCollection(field)" name="actions" />
      </div>
    </template>
    <slot />
    <template #actions><slot v-if="!schemaCollection(field)" name="actions" /></template>
    <template #hint>
      <FieldHints
        :description="settings.expandFieldDescriptions ? field.description : undefined"
        :warning="field.warning"
        :danger="field.danger"
      />
    </template>
  </FieldRow>
</template>
<script setup lang="ts">
import FieldRow from '@/shared/ui/FieldRow.vue';
import FieldLabel from '@/shared/ui/FieldLabel.vue';
import FieldHints from '@/shared/ui/FieldHints.vue';
import { useSettingsStore } from '@/stores/settings.store';
import type { FieldSchema } from '@/domain/schema/schema.types';
import { schemaCollection } from '@/domain/schema/schema-values';
defineProps<{ field: FieldSchema; path?: string }>();
const settings = useSettingsStore();
</script>
