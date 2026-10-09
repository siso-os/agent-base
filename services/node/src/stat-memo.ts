import { readFileSync, readdirSync, statSync, type Stats } from "node:fs";

/** Memoizes file read results based on stat stamps (mtime + size). */
type CacheEntry<T> = { stamp: string; value: T; at: number };
const fileCache = new Map<string, CacheEntry<string>>();
const dirCache = new Map<string, CacheEntry<string[]>>();
// Only small files (metadata, task headers) are kept; transcripts can be many MB and
// already have their own derived-row caches, so they are read through, never retained.
const MAX_CACHED_BYTES = 64 * 1024, MAX_CACHED_FILES = 4096;

// For testing: count of file content reads and directory reads
let readFileCount = 0;
let readdirCount = 0;

export function resetReadCounts() {
  readFileCount = 0;
  readdirCount = 0;
}

export function getReadFileCount() {
  return readFileCount;
}

export function getReaddirCount() {
  return readdirCount;
}

/** Generate a stamp from stat info: dev:ino:size:mtimeMs:ctimeMs */
function statStamp(st: Stats): string {
  return `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
}

/**
 * Read a file only if it has changed since last read.
 * Returns null if file doesn't exist.
 * Stat call is always made (cheap); file content read is skipped if stamp hasn't changed.
 */
export function readIfChanged(path: string): string | null {
  let st: Stats | null = null;
  try {
    st = statSync(path);
  } catch {
    fileCache.delete(path);
    return null;
  }

  const stamp = statStamp(st);
  const cached = fileCache.get(path);
  if (cached && cached.stamp === stamp) {
    return cached.value;
  }

  // File exists and stamp is new or absent; read it
  try {
    const content = readFileSync(path, "utf8");
    readFileCount++;
    if (st.size <= MAX_CACHED_BYTES && (fileCache.has(path) || fileCache.size < MAX_CACHED_FILES)) fileCache.set(path, { stamp, value: content, at: Date.now() });
    else fileCache.delete(path);
    return content;
  } catch {
    fileCache.delete(path);
    return null;
  }
}

/**
 * Read a directory only if it has changed.
 * Returns empty array if directory doesn't exist.
 * Stat call is always made; directory listing is skipped if stamp hasn't changed.
 */
export function readdirIfChanged(path: string): string[] {
  let st: Stats | null = null;
  try {
    st = statSync(path);
  } catch {
    dirCache.delete(path);
    return [];
  }

  const stamp = statStamp(st);
  const cached = dirCache.get(path);
  if (cached && cached.stamp === stamp) {
    return cached.value;
  }

  // Directory exists and stamp is new or absent; read it
  try {
    const entries = readdirSync(path);
    readdirCount++;
    dirCache.set(path, { stamp, value: entries, at: Date.now() });
    return entries;
  } catch {
    dirCache.delete(path);
    return [];
  }
}

/**
 * Periodically evict stale cache entries (not accessed in 10 minutes).
 * Call this occasionally in long-running polls.
 */
export function evictStaleCache(maxAgeMs = 10 * 60 * 1000) {
  const now = Date.now();
  for (const [key, entry] of fileCache) {
    if (now - entry.at > maxAgeMs) fileCache.delete(key);
  }
  for (const [key, entry] of dirCache) {
    if (now - entry.at > maxAgeMs) dirCache.delete(key);
  }
}

/**
 * Clear all caches (used for testing).
 */
export function clearCache() {
  fileCache.clear();
  dirCache.clear();
}

/** For testing: get cache stats */
export function getCacheStats() {
  return { fileCacheSize: fileCache.size, dirCacheSize: dirCache.size };
}
