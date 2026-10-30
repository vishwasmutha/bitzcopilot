import "server-only";

const store = new Map<string, { at: number; value: unknown }>();

/** Small in-process cache so heavy reads (forecasts) are not recomputed on every page view. */
export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  store.set(key, { at: Date.now(), value });
  if (store.size > 200) {
    const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) store.delete(oldest[0]);
  }
  return value;
}

/** Drop every cached value whose key starts with the prefix, e.g. after the owner edits their cash items. */
export function forget(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
