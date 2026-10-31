import { createNewModProject } from '@/services/mod-creation.service';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields } from '@/shared/lib/log-fields';
import type { CreatedMod, CreateModRequest } from '@/shared/types';

export async function createModProject(request: CreateModRequest): Promise<CreatedMod> {
  const created = await createNewModProject(request);
  recordLogBestEffort({
    level: 'info',
    code: 'mod.created',
    message: 'mod created',
    path: null,
    line: null,
    fields: logFields({ modRoot: created.modRoot, template: request.template.id, destination: request.destination.kind }),
  });
  return created;
}
