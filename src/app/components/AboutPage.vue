<template>
  <div class="page-content">
    <header class="page-header">
      <div class="page-identity">
        <h1 class="page-title">关于</h1>
        <p class="page-description">星界罗盘 [Circinus ad Astra] 的版本、作者和更新记录。</p>
      </div>
    </header>

    <section class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="panel-section-title">应用信息</h3>
      <div class="ui-layout-grid">
        <FieldRow readonly label="名称"
          ><strong class="ui-emphasis ui-text-normal ui-layout-shrink ui-text-wrap">星界罗盘 [Circinus ad Astra]</strong></FieldRow
        >
        <FieldRow readonly label="当前版本"
          ><strong class="ui-emphasis ui-text-normal ui-layout-shrink ui-text-wrap">0.1.0</strong></FieldRow
        >
        <FieldRow readonly label="作者"
          ><strong class="ui-emphasis ui-text-normal ui-layout-shrink ui-text-wrap">cake、AnyIDElse</strong></FieldRow
        >
      </div>
    </section>

    <section class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="panel-section-title">更新内容</h3>
      <!-- eslint-disable-next-line vue/no-v-html -- content from bundled static .md file, not user input -->
      <div class="rich-text ui-text-soft ui-text-small" v-html="changelogHtml" />
    </section>
  </div>
</template>

<script setup lang="ts">
import FieldRow from '@/shared/ui/FieldRow.vue';
import { computed } from 'vue';
import { marked } from 'marked';
import changelogRaw from '../../../CHANGELOG.md?raw';

const changelogHtml = computed(() =>
  marked.parse(changelogRaw, { async: false }).replace(/<([a-z][a-z0-9]*)(?=[\s>])/g, '<$1 class="rich-text-node rich-text-$1"'),
);
</script>
