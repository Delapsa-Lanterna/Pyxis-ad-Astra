export interface ResidentCacheLimits {
  entries: number;
  bytes: number;
}
interface Entry<T> {
  value: T;
  bytes: number;
  active: number;
}

export function createResidentCache<T>(limits: () => ResidentCacheLimits) {
  const entries = new Map<string, Entry<T>>();
  const idle = new Map<string, Entry<T>>();
  let idleBytes = 0,
    activeBytes = 0,
    activeEntries = 0;
  let evictions = 0;
  function trim() {
    const budget = limits();
    while (idle.size && (!budget.entries || !budget.bytes || idle.size > budget.entries || idleBytes > budget.bytes)) {
      const key = idle.keys().next().value!;
      remove(key);
      evictions++;
    }
  }
  function get(key: string): T | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (!entry.active) {
      idle.delete(key);
      idle.set(key, entry);
    }
    return entry.value;
  }
  function put(key: string, value: T, bytes: number, active = 0) {
    remove(key);
    const entry = { value, bytes, active };
    entries.set(key, entry);
    if (active) {
      activeBytes += bytes;
      activeEntries++;
    } else {
      idle.set(key, entry);
      idleBytes += bytes;
    }
    trim();
  }
  function retain(key: string) {
    const entry = entries.get(key)!;
    if (!entry.active) {
      idle.delete(key);
      idleBytes -= entry.bytes;
      activeBytes += entry.bytes;
      activeEntries++;
    }
    entry.active++;
    return () => {
      if (entries.get(key) === entry) release(key);
    };
  }
  function release(key: string) {
    const entry = entries.get(key);
    if (entry) {
      entry.active--;
      if (!entry.active) {
        activeBytes -= entry.bytes;
        activeEntries--;
        idle.set(key, entry);
        idleBytes += entry.bytes;
      }
      trim();
    }
  }
  function remove(key: string) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    if (entry.active) {
      activeBytes -= entry.bytes;
      activeEntries--;
    } else {
      idle.delete(key);
      idleBytes -= entry.bytes;
    }
  }
  function clear() {
    entries.clear();
    idle.clear();
    idleBytes = 0;
    activeBytes = 0;
    activeEntries = 0;
  }
  function stats() {
    return { activeBytes, idleBytes, activeEntries, idleEntries: entries.size - activeEntries, evictions };
  }
  return { get, put, retain, release, remove, clear, stats, keys: () => entries.keys() };
}
