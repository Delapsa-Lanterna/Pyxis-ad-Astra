import { RESOURCE_SOURCES } from '@/shared/types';

// Log entry fields helper: drops empty values so log lines stay dense;
// returns null when nothing remains, matching the nullable wire field.
export function logFields(values: Record<string, string | number | null | undefined>): Record<string, string> | null {
  const entries = Object.entries(values).filter(([, value]) => value !== null && value !== undefined && value !== '');
  return entries.length > 0 ? Object.fromEntries(entries.map(([key, value]) => [key, String(value)])) : null;
}

// Select identity metadata explicitly; request bodies and raw input stay with their owners.
export function logIdentity(value: unknown, prefix = '', scalar = false): Record<string, string> {
  if (Array.isArray(value)) {
    const fields = { [prefix + '.count']: String(value.length) };
    value.forEach((item, index) => Object.assign(fields, logIdentity(item, prefix + '[' + index + ']', scalar)));
    return fields;
  }
  if (value !== null && typeof value === 'object') {
    const fields: Record<string, string> = {};
    for (const key of Object.keys(value)) {
      if (key === 'source') {
        const source: unknown = Reflect.get(value, key);
        if (typeof source === 'string' && !RESOURCE_SOURCES.some((identity) => identity === source)) {
          fields[prefix ? prefix + '.sourceCharacters' : 'sourceCharacters'] = String(source.length);
          continue;
        }
      }
      if (
        /^(sessionId|sessionIds|modRoot|modRoots|starsectorRoot|id|ids|previousId|nextId|entityId|ownerId|ownerKind|kind|type|table|rowKey|rowKeys|sourceRowIndex|rowIndex|column|line|label|path|paths|file|relPath|absolutePath|directory|directories|source|target|identity|root|write|reference|sources|resources|targets|request|requestId|receiverGeneration|revision|version|project|purpose|operationId|phase|accepted|status|state|direction|entryId|encoding|searchField|initialCount|referenceIds|catalog|catalogSource|payload|action|input|parameters|origin|plan|snapshot|baseline|change|create|destination|changes|identityChanges|keyMap|before|after|beforePath|afterPath|beforeExists|afterExists|previousKey|nextKey|linkedRecord|baseVersions|fingerprint|activeModRoot|activeSessionId|currentTab|currentView|jsonPage|result|generation|fontId|fontDirectory|isComment|reason|waiting|cache|rows|entries|groups|options|records|mods|files|conflicts|newSources|createOverrides|history)$/.test(
          key,
        )
      )
        Object.assign(
          fields,
          logIdentity(
            Reflect.get(value, key),
            prefix ? prefix + '.' + key : key,
            !/^(payload|input|parameters|snapshot|baseline|plan|request|result)$/.test(key),
          ),
        );
    }
    return fields;
  }
  return scalar && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    ? { [prefix]: String(value) }
    : {};
}
