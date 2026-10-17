export const CSS_SCOPES = new Map(
  Object.entries({
    about: ['about'],
    'app-shell': ['app-frame', 'app-shell', 'aligned-shell', 'aligned-narrow', 'aligned-nav-hidden'],
    'array-of-object': ['array'],
    'color-picker': ['color-picker'],
    config: ['config', 'faction', 'mission', 'color-swatch'],
    'create-mod': ['create-mod'],
    'data-table': ['data-table', 'csv', 'table'],
    'detail-pane': ['detail', 'pane-title', 'record-card', 'thumbnail-placeholder', 'kv-list', 'schema-preview'],
    'editor-window': [
      'editor',
      'preview',
      'projectile',
      'ship-mode',
      'canvas-stage',
      'inspector-title',
      'system-editor',
      'bounds',
      'port',
      'sprite',
      'item-list',
    ],
    'empty-state': ['empty-state'],
    'file-editor': ['file-editor'],
    'file-history': ['file-history'],
    'font-text': ['font'],
    'game-overview': ['game-overview', 'game-warning'],
    immersive: ['immersive', 'ship-immersive', 'weapon-immersive', 'wing-immersive', 'weapon-filter', 'aligned-game'],
    'joint-conflict': ['joint-conflict'],
    'json-field-editor': ['json-field', 'json-value-input'],
    'key-value-editor': ['key-value-editor', 'kv-row', 'kv-key', 'kv-value', 'reference-key-value'],
    'lab-debug': ['lab-debug', 'lab-host-status'],
    'lab-dialog': ['lab-dialog'],
    'lab-editor': ['lab-editor', 'lab-file-path', 'lab-footer-note'],
    'lab-entity': ['lab-entity', 'lab-list-heading', 'lab-create-entity', 'entity'],
    'lab-feedback': ['lab-feedback'],
    'lab-host': ['lab-toolbar', 'lab-tools', 'lab-colors', 'lab-versions', 'lab-scenes', 'lab-comparison', 'lab-panel'],
    'lab-inspector': ['lab-inspector', 'lab-groups-body'],
    'lab-menu': ['lab-menu'],
    'lab-resource': ['lab-resource'],
    'lab-window-cover': ['lab-window-cover'],
    'mod-card': ['mod-card', 'overview-mod-card'],
    'mod-files': ['mod-files'],
    'mod-navigation': ['mod-navigation', 'nav'],
    'mod-opening-failure': ['mod-opening-failure'],
    'mod-overview': ['mod-overview'],
    'mod-tabs': ['mod-tab', 'mod-tabs', 'aligned-nav-toggle'],
    navigation: ['aligned-navigation', 'aligned-nav-backdrop', 'aligned-nav-enter', 'aligned-nav-leave', 'aligned-nav-mask'],
    'overview-page': ['overview'],
    'schema-form': [
      'schema-form',
      'schema-section',
      'schema-field',
      'section',
      'field',
      'nested',
      'path',
      'lab-group',
      'lab-field',
      'spec-label',
      'form-grid',
    ],
    'schema-select-option': ['schema-select'],
    settings: ['settings', 'accent'],
    'startup-error': ['startup-error'],
    titlebar: ['titlebar'],
    variant: ['variant'],
    'window-context-menu': ['window-context-menu', 'context-menu'],
    'window-runtime': ['window-runtime'],
    workspace: ['workspace', 'topbar', 'top-action', 'top-search', 'content-grid', 'view-heading', 'view-meta'],
  }),
);

/** @param {string} name @returns {string | undefined} */
export function classScope(name) {
  for (const [scope, prefixes] of CSS_SCOPES) if (prefixes.some((prefix) => name === prefix || name.startsWith(prefix + '-'))) return scope;
}

/** @param {string[]} names @returns {string} */
export function selectorScope(names) {
  const relevant = names.filter(
    (name) =>
      !['app-shell', 'app-frame', 'aligned-shell', 'lab-page-root', 'lab-spec-page', 'aligned-narrow', 'aligned-nav-hidden'].includes(name),
  );
  return relevant.map(classScope).find(Boolean) ?? names.map(classScope).find(Boolean) ?? 'base';
}
