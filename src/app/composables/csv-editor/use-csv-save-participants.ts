import { computed, onScopeDispose, shallowRef, watch } from 'vue';
import { useProjectStore } from '@/stores/project.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useSaveCommandStore, type SaveSessionHandle } from '@/stores/save-command.store';
import { saveCsvChanges } from '@/orchestrators/csv-save.orchestrator';
import { completeSavedWrite, retryPendingModSyncs } from '@/orchestrators/project-sync.orchestrator';
import { hasCsvTableDraftChanges } from '@/domain/csv-editor/csv-table-draft';
import { TABLE_KEYS, type AppFeedback, type AssociatedSpecChange, type WriteResult } from '@/shared/types';
import type { AssociatedSpecCandidate } from '@/domain/csv-editor/associated-spec-candidates';

export function useCsvSaveParticipants(
  feedback: AppFeedback,
  selectAssociatedSpecs: (candidates: AssociatedSpecCandidate[]) => Promise<AssociatedSpecChange[] | null>,
) {
  const project = useProjectStore();
  const tables = useCsvEditorStore();
  const commands = useSaveCommandStore();
  const registrations = new Map<string, { state: ReturnType<typeof tables.getCsvModState>; release: () => void }>();
  const stop = watch(
    () => [...project.manifests].map(([root, manifest]) => [root, manifest.sessionId, tables.getCsvModState(root)]),
    () => {
      for (const [key, entry] of registrations) {
        const [root, sessionId] = JSON.parse(key) as [string, string];
        if (project.getManifest(root)?.sessionId !== sessionId || tables.getCsvModState(root) !== entry.state) {
          entry.release();
          registrations.delete(key);
        }
      }
      for (const [modRoot, manifest] of project.manifests) {
        const state = tables.getCsvModState(modRoot);
        if (!state) continue;
        for (const table of TABLE_KEYS) {
          const registrationKey = JSON.stringify([modRoot, manifest.sessionId, table]);
          if (registrations.has(registrationKey)) continue;
          const target = { sessionId: manifest.sessionId, modRoot, table };
          const writeTarget = project.tableWriteTargets.find((target) => target.modRoot === modRoot && target.table === table)!;
          const inputs = tables.getTableInputs(modRoot, table);
          const pendingReceipt = shallowRef<WriteResult | null>(null);
          async function synchronize(receipt: WriteResult) {
            pendingReceipt.value = receipt;
            await completeSavedWrite({ modRoot, sessionId: manifest.sessionId, result: receipt, label: '保存 ' + table + ' CSV' });
            pendingReceipt.value = null;
            feedback.success('当前 CSV 表已保存');
          }
          const handle: SaveSessionHandle = {
            targetKey: inputs.targetKey,
            modRoot: computed(() => modRoot),
            saving: computed(() => state.documents[table].saving),
            pendingSynchronization: computed(() => pendingReceipt.value !== null),
            waitForSave: async () => {
              if (pendingReceipt.value) await synchronize(pendingReceipt.value);
              else await retryPendingModSyncs(modRoot);
              return true;
            },
            editing: {
              targets: computed(() => [writeTarget]),
              label: String(manifest.modInfo?.name ?? modRoot) + ' / ' + table,
              dirty: computed(() => hasCsvTableDraftChanges(state.documents[table]) || inputs.dirty.value),
              draftSession: {
                draftValue: computed(() => ({ rows: state.documents[table].rows, order: state.documents[table].rowOrder })),
                inputs,
              },
              hold: (requestId) => {
                tables.lockTable(target, requestId);
                return () => tables.releaseTableLock(requestId);
              },
              save: async () => {
                if (pendingReceipt.value) await synchronize(pendingReceipt.value);
                const latest = project.getManifest(modRoot);
                if (latest?.sessionId !== target.sessionId || tables.getCsvModState(modRoot) !== state) return { status: 'cancelled' };
                return saveCsvChanges({ table, manifest: latest, selectAssociatedSpecs, feedback, synchronize });
              },
            },
          };
          tables.bindSaveActions(target, {
            saving: computed(() => commands.isSaveQueued(handle)),
            pendingSynchronization: handle.pendingSynchronization!,
            save: () => commands.requestSave(handle),
            waitForSave: () => commands.waitForSession(handle),
          });
          registrations.set(registrationKey, { state, release: commands.registerSaveSession(handle) });
        }
      }
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    stop();
    for (const entry of registrations.values()) entry.release();
    registrations.clear();
  });
}
