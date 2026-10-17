import { onScopeDispose } from 'vue';
import { createReadTicketOwner } from '@/shared/runtime/read-request';
const owners = new Set<ReturnType<typeof createReadTicketOwner>>();
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
  const owner = createReadTicketOwner();
  owners.add(owner);
  if (prepared) owner.pause();
  onScopeDispose(() => {
    owners.delete(owner);
    owner.revoke();
  });
  return owner;
}
