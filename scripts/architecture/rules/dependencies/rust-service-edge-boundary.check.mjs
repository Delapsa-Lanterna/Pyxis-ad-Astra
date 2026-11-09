import { test } from 'node:test';
import { architectureFixtures, messages } from '../../testing/fixtures.mjs';
import assert from 'node:assert/strict';
import { rustServiceEdgeBoundaryRule } from './rust-service-edge-boundary.mjs';

const serviceAssembly =
  'pub(crate) use project::query::entities::query_entity; pub(crate) use project::write::entity_write::content::save_entity_spec;';

test('application lifecycle releases the Java analysis infrastructure', () => {
  const allowed = architectureFixtures({
    'src-tauri/src/services/app_lifecycle.rs': 'fn close(){crate::services::java_analysis::shutdown(app);}',
  });
  assert.deepEqual(rustServiceEdgeBoundaryRule.check(allowed), []);
  const rejected = architectureFixtures({
    'src-tauri/src/services/spec_editor.rs': 'fn edit(){crate::services::java_analysis::shutdown(app);}',
  });
  assert.equal(rustServiceEdgeBoundaryRule.check(rejected).length, 1);
});

test('Java analysis consumes project inputs and project sync refreshes its owned sessions', () => {
  const context = architectureFixtures({
    'src-tauri/src/services/java_analysis/inputs.rs': 'fn inputs(){crate::services::project::current_project_manifest(id);}',
    'src-tauri/src/services/project_sync.rs': 'fn close(){crate::services::java_analysis::close_registered_session(id);}',
  });
  assert.deepEqual(rustServiceEdgeBoundaryRule.check(context), []);
});

test('project synchronization assembles authorized roots and source watches', () => {
  const context = architectureFixtures({
    'src-tauri/src/services/project_sync.rs':
      'fn open() { crate::services::project_session::resolve_project_session_roots(); crate::services::source_watch::subscribe(); }',
  });
  assert.deepEqual(rustServiceEdgeBoundaryRule.check(context), []);
});

test('directory opening and Mod creation consume the formal source root capability', () => {
  for (const source of ['src-tauri/src/services/directory_opening/detection.rs', 'src-tauri/src/services/mod_creation.rs']) {
    const context = architectureFixtures({ [source]: 'fn resolve() { crate::services::project::resolve_game_mods_directory(root); }' });
    assert.deepEqual(rustServiceEdgeBoundaryRule.check(context), []);
  }
  const context = architectureFixtures({
    'src-tauri/src/services/mod_creation.rs': '\nfn resolve() { crate::services::directory_opening::scan_game_overview(root); }',
  });
  const [diagnostic] = rustServiceEdgeBoundaryRule.check(context);
  assert.ok(diagnostic);
  assert.equal(diagnostic.file, 'src-tauri/src/services/mod_creation.rs');
  assert.equal(diagnostic.line, 2);
  assert.equal(diagnostic.target, 'crate::services::directory_opening::scan_game_overview');
});

test('session opening consumes the official settings root', () => {
  const context = architectureFixtures({
    'src-tauri/src/services/project_session.rs': 'fn open() { crate::services::app_settings::starsector_root(); }',
  });
  assert.deepEqual(messages(rustServiceEdgeBoundaryRule.check(context)), []);
});

test('project synchronization owns the complete session release', () => {
  const context = architectureFixtures({
    'src-tauri/src/services/app_lifecycle.rs': 'fn release() { crate::services::project_sync::release_project_session(session); }',
  });
  assert.deepEqual(messages(rustServiceEdgeBoundaryRule.check(context)), []);
});

test('application assembly consumes the media cache configuration capability', () => {
  assert.deepEqual(
    messages(
      rustServiceEdgeBoundaryRule.check(
        architectureFixtures({
          'src-tauri/src/commands/app_lifecycle.rs':
            'fn load() { crate::services::project::resources::media_cache::configure_media_cache(&limits); }',
        }),
      ),
    ),
    [],
  );
});

test('settings consumers keep unrelated project capabilities at their owner', () => {
  const failures = messages(
    rustServiceEdgeBoundaryRule.check(
      architectureFixtures({
        'src-tauri/src/services/app_settings.rs': 'fn load() { crate::services::project::query_resource_data_urls(&resources); }',
      }),
    ),
  );
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.match(failures[0], /must not depend on service project/);
});

test('project save dispatch consumes transactions and editing services from its owner', () => {
  for (const target of ['project_sync', 'file_editor', 'config_entity', 'json_file', 'misc_config']) {
    const allowed = architectureFixtures({
      'src-tauri/src/services/project_save.rs': 'fn save() { crate::services::' + target + '::run(); }',
    });
    assert.deepEqual(rustServiceEdgeBoundaryRule.check(allowed), []);
    const denied = architectureFixtures({
      'src-tauri/src/services/write_transactions.rs': '\nfn save() { crate::services::' + target + '::run(); }',
    });
    const [diagnostic] = rustServiceEdgeBoundaryRule.check(denied);
    assert.ok(diagnostic);
    assert.equal(diagnostic.line, 2);
  }
});

test('session foundations consume their own release primitives', () => {
  for (const target of ['project_sync', 'windows']) {
    const context = architectureFixtures({
      'src-tauri/src/services/project_session.rs': '\nfn release() { crate::services::' + target + '::release_session(session); }',
    });
    const [diagnostic] = rustServiceEdgeBoundaryRule.check(context);
    assert.ok(diagnostic);
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.target, 'crate::services::' + target + '::release_session');
  }
});

test('log directory assembly captures workspace roots at its actual owner', () => {
  const allowed = architectureFixtures({
    'src-tauri/src/services/app_lifecycle.rs':
      'fn prepare() { crate::services::workspace_persistence::load_persisted_workspace_roots(root); crate::services::app_log::prepare_log_directory(root, path, roots); }',
  });
  assert.deepEqual(rustServiceEdgeBoundaryRule.check(allowed), []);
  for (const consumer of ['app_settings', 'app_log/directory', 'app_log']) {
    const source = 'src-tauri/src/services/' + consumer + '.rs';
    const context = architectureFixtures({
      [source]: '\nfn prepare() { crate::services::workspace_persistence::load_persisted_workspace_roots(root); }',
    });
    const [diagnostic] = rustServiceEdgeBoundaryRule.check(context);
    assert.ok(diagnostic);
    assert.equal(diagnostic.file, source);
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.target, 'crate::services::workspace_persistence::load_persisted_workspace_roots');
  }
});

test('production permissions exclude test-only imports through formal service exports', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/mod.rs': serviceAssembly,
    'src-tauri/src/services/app_settings.rs': '#[cfg(test)] mod tests { fn query() { crate::services::query_entity(); } }',
  });
  assert.deepEqual(messages(rustServiceEdgeBoundaryRule.check(files)), []);
});
