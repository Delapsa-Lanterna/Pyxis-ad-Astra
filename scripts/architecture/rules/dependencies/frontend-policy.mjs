/** @typedef {import('../../facts/classify.mjs').FrontendPathClass} PathRole */

/** @param {PathRole} current @param {PathRole} target @param {import('../../facts/imports.mjs').ResolvedImport} edge @returns {{message: string, expected: string} | null} */
export function frontendDependencyFailure(current, target, edge) {
  if (current.role === 'bootstrap' && target.layer === 'styles') return null;
  if (!validFrontendDependency(current.layer, target.layer))
    return {
      message: `${current.layer} must not import ${target.layer}`,
      expected: /** @type {string[]} */ (layers[current.layer]).join(', '),
    };
  if (
    current.path === 'src/orchestrators/settings-persistence.orchestrator.ts' &&
    ((target.layer === 'orchestrators' && target.domain?.startsWith('workspace-')) ||
      (target.layer === 'stores' && ['workspace', 'save-command'].includes(target.domain ?? '')) ||
      target.path === 'src/services/directory.service.ts' ||
      target.path === 'src/domain/project/load-diagnostics.ts')
  )
    return { message: 'workspace source transitions belong to the workspace action', expected: 'settings persistence dependencies' };
  const ownedProjection = [
    ['src/domain/edit-session.ts', 'src/domain/project/save-edits.ts'],
    ['src/app/composables/use-edit-target-draft-session.ts', 'src/domain/project/save-edits.ts'],
    ['src/app/composables/use-edit-target-draft-session.ts', 'src/stores/project-sync.store.ts'],
    ['src/domain/resources/hull-references.ts', 'src/domain/schema/schema-options.ts'],
  ];
  if (ownedProjection.some(([source, provider]) => current.path === source && target.path === provider))
    return {
      message: 'consumer projections must use their own rules and shared contracts',
      expected: 'owned projection or shared contract',
    };
  const queryKernel = current.path === 'src/services/query-cache.service.ts' || current.path === 'src/shared/types/query-cache.types.ts';
  const businessQuery = [
    'src/services/entity-query.service.ts',
    'src/services/csv-table.service.ts',
    'src/services/source-options.service.ts',
    'src/services/hull-reference.service.ts',
    'src/services/resource-reference.service.ts',
    'src/services/joint-edit.service.ts',
    'src/shared/types/entity-query.types.ts',
    'src/shared/types/tables.types.ts',
    'src/shared/types/schema.types.ts',
    'src/shared/types/resources.types.ts',
    'src/shared/types/joint-edit.types.ts',
  ];
  if (queryKernel && businessQuery.includes(target.path))
    return { message: 'session query foundations must be consumed by business queries', expected: 'session query foundation' };
  const budgetFoundation = [
    'src/shared/runtime/cache-limits.ts',
    'src/shared/types/cache-limits.types.ts',
    'src/domain/cache-limits.ts',
  ].includes(current.path);
  if (
    budgetFoundation &&
    (target.domain === 'settings' ||
      target.domain === 'app-settings' ||
      target.path === 'src/shared/types/app-settings.types.ts' ||
      target.path === 'src/shared/types/query-cache.types.ts')
  )
    return { message: 'cache budgets must be consumed by settings and session queries', expected: 'pure cache budget foundation' };
  const foundation =
    (current.layer === 'services' &&
      ['project-session', 'project-projection', 'query-cache', 'resource-media', 'resource-reference'].includes(current.domain ?? '')) ||
    (current.layer === 'stores' && current.domain === 'project');
  if (foundation && target.domain === 'project-sync')
    return {
      message: 'session, query and resource foundations must be consumed by project synchronization',
      expected: 'project synchronization consumer',
    };
  if (!edge.typeOnly && current.role === 'component' && ['service', 'orchestrator'].includes(target.role))
    return {
      message: 'components must consume ViewModel/composable state and actions',
      expected: 'ViewModel/composable state and actions',
    };
  if (!edge.typeOnly && current.layer === 'services' && target.layer === 'services' && !allowedServiceEdge(current, target))
    return {
      message: 'service composition must follow the declared capability dependency matrix',
      expected: 'declared service dependency matrix',
    };
  const runtimeOwner = current.layer === 'windows' || (current.layer === 'shared' && current.domain === 'runtime');
  if (!edge.typeOnly && edge.specifier.startsWith('@tauri-apps/') && !runtimeOwner)
    return {
      message: 'Tauri runtime access belongs behind window or shared runtime boundaries',
      expected: 'window or shared runtime boundary',
    };
  return null;
}

const serviceEdges = new Set([
  'query-cache -> project-projection',
  'resource-media -> project-projection',
  'entity-query -> query-cache',
  'csv-table -> query-cache',
  'joint-edit -> query-cache',
  'source-options -> query-cache',
  'hull-reference -> query-cache',
  'resource-reference -> query-cache',
  'engine-assets -> query-cache',
  'weapon-data -> resource-reference',
  'spec-weapon-editor -> resource-reference',
  'spec-projectile-editor -> resource-reference',
  'spec-ship-editor -> resource-reference',
  'json-entity -> resource-reference',
  'json-entity -> json-resource',
  'json-entity -> entity-query',
  'json-file -> entity-query',
  'misc-config -> query-cache',
  'json-resource -> resource-media',
  'csv-table -> entity-query',
  'csv-table -> resource-media',
  'spec-weapon-editor -> weapon-data',
  'spec-weapon-editor -> entity-query',
  'spec-projectile-editor -> entity-query',
  'spec-projectile-editor -> resource-media',
  'weapon-fire-preview -> entity-query',
  'weapon-data -> entity-query',
  'weapon-data -> resource-media',
  'weapon-fire-preview -> weapon-data',
  'spec-editor -> files',
  'spec-editor -> entity-query',
  'spec-ship-editor -> entity-query',
  'spec-ship-editor -> joint-edit',
  'spec-ship-editor -> resource-media',
  'spec-system-editor -> entity-query',
]);

/** @param {PathRole} from @param {PathRole} to @returns {boolean} */
export function allowedServiceEdge(from, to) {
  return from.domain === to.domain || serviceEdges.has(`${from.domain} -> ${to.domain}`);
}

/** @type {Record<string, string[]>} */
const layers = {
  shared: ['shared'],
  domain: ['domain', 'shared'],
  services: ['services', 'domain', 'shared'],
  stores: ['stores', 'domain', 'shared'],
  orchestrators: ['orchestrators', 'services', 'stores', 'domain', 'windows', 'shared'],
  windows: ['windows', 'orchestrators', 'services', 'domain', 'shared'],
  app: ['app', 'windows', 'orchestrators', 'services', 'stores', 'domain', 'shared'],
  styles: ['styles'],
};

/** @param {import('../../facts/classify.mjs').FrontendLayer} from @param {import('../../facts/classify.mjs').FrontendLayer} to @returns {boolean} */
export function validFrontendDependency(from, to) {
  if (from === 'test') return true;
  if (to === 'test') return false;
  return !layers[from] || !layers[to] || layers[from].includes(to);
}
