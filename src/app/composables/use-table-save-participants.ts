import { computed, onScopeDispose, watch } from 'vue';
import { useProjectStore } from '@/stores/project.store';
import { useTablesStore } from '@/stores/tables.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { saveTableChanges, pendingTableSave } from '@/orchestrators/table-save.orchestrator';
import { retryPendingModSyncs } from '@/orchestrators/project-sync.orchestrator';
import { hasCsvTableDraftChanges } from '@/domain/tables/csv-table-draft';
import { TABLE_KEYS, type AppFeedback, type AssociatedSpecChange } from '@/shared/types';
import type { AssociatedSpecCandidate } from '@/domain/tables/associated-spec-candidates';

export function useTableSaveParticipants(
  feedback: AppFeedback,
  selectAssociatedSpecs: (candidates: AssociatedSpecCandidate[]) => Promise<AssociatedSpecChange[] | null>,
) {
  const project = useProjectStore();
  const tables = useTablesStore();
  const commands = useSaveCommandStore();
  let releases: Array<() => void> = [];
  const stop = watch(
    () =>
      JSON.stringify([...project.manifests].map(([root, manifest]) => [root, manifest.sessionId, Boolean(tables.getModTableState(root))])),
    () => {
      releases.forEach((release) => release());
      releases = [];
      for (const [modRoot, manifest] of project.manifests) {
        const state = tables.getModTableState(modRoot);
        if (!state) continue;
        for (const table of TABLE_KEYS) {
          const writeTarget = project.tableWriteTargets.find((target) => target.modRoot === modRoot && target.table === table)!;
          const inputs = tables.getTableInputs(modRoot, table);
          const targetKey = computed(() => JSON.stringify([manifest.sessionId, modRoot, table]));
          const dirty = computed(() => hasCsvTableDraftChanges(state, table) || inputs.dirty.value);
          const ownsSave = () => pendingTableSave()?.target.modRoot === modRoot && pendingTableSave()?.target.table === table;
          releases.push(
            commands.registerSaveSession({
              targetKey,
              modRoot: computed(() => modRoot),
              saving: computed(() => ownsSave()),
              pendingSynchronization: computed(() => useProjectSyncStore().pending.some((entry) => entry.event.modRoot === modRoot)),
              waitForSave: async () => {
                const pending = pendingTableSave();
                if (pending && ownsSave()) {
                  const result = await pending.promise;
                  if (result.status === 'cancelled') return false;
                }
                await retryPendingModSyncs(modRoot);
                return true;
              },
              editing: {
                targets: computed(() => [writeTarget]),
                hold: (requestId) => {
                  tables.lockTable({ sessionId: manifest.sessionId, modRoot, table }, requestId);
                  return () => tables.releaseTableLock(requestId);
                },
                label: `${manifest.modInfo?.name ?? modRoot} / ${table}`,
                dirty,
                draftSession: { draftValue: computed(() => ({ rows: state.tables[table], order: state.rowOrders[table] })), inputs },
                save: async () => {
                  const result = await saveTableChanges({ table, manifest, selectAssociatedSpecs, feedback });
                  return { saved: result.status !== 'cancelled', receipt: result.status === 'saved' ? result.receipt : null };
                },
              },
            }),
          );
        }
      }
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    stop();
    releases.forEach((release) => release());
  });
}
