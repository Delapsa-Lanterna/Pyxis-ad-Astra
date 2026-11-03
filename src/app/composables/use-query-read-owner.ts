import { onScopeDispose } from 'vue';
import { createReadOwner } from '@/shared/runtime/read-request';
const owners = new Set<ReturnType<typeof createReadOwner>>();
let prepared = false;
export function pauseQueryReads() {
  prepared = true;
  for (const owner of owners) owner.pause();
  return async () => {
    prepared = false;
    for (const owner of owners) owner.resume();
  };
}
export function useQueryReadOwner() {
  const owner = createReadOwner();
  owners.add(owner);
  if (prepared) owner.pause();
  onScopeDispose(() => {
    owners.delete(owner);
    owner.revoke();
  });
  return owner;
}
