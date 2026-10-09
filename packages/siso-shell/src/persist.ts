import { useEffect, useRef, useState } from "react";

/**
 * Per-window conveniences (a width, a layout, which shelves are open). Storage can be missing or throw (a private
 * window, blocked site data), so every read has a default and every write may silently not last.
 */
let prefix = "siso:";
export function setPersistPrefix(p: string) {
  prefix = p;
}
/**
 * A saved value of the wrong shape (an object where a list was saved, null, a string) is the default too: one bad key
 * blanked the whole app at launch (overnight QA, 3 Oct). The default's shape is the check: a list stays a list, a record
 * a record, a string a string; a null default takes anything.
 */
export function load<T>(key: string, fallback: T): T {
  try {
    const v = window.localStorage.getItem(prefix + key);
    return v === null ? fallback : sameShape(JSON.parse(v), fallback);
  } catch {
    return fallback;
  }
}
function sameShape<T>(v: unknown, fallback: T): T {
  if (fallback === null || fallback === undefined) return v as T;
  if (Array.isArray(fallback)) return (Array.isArray(v) ? v : fallback) as T;
  if (typeof fallback === "object") return (v !== null && typeof v === "object" && !Array.isArray(v) ? v : fallback) as T;
  return (typeof v === typeof fallback ? v : fallback) as T;
}
export function save(key: string, value: unknown) {
  try {
    window.localStorage.setItem(prefix + key, JSON.stringify(value));
  } catch {
    /* lasts this session only */
  }
}
/** useState that remembers its value under `key`. */
export function usePersisted<T>(key: string, fallback: T) {
  const [v, setV] = useState<T>(() => load(key, fallback));
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setV(load(key, fallback));
      return;
    }
    save(key, v);
  }, [key, v]);
  return [v, setV] as const;
}
