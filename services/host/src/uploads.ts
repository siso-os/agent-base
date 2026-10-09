import { realpathSync, statSync } from "node:fs";
import path from "node:path";

/** A regular upload file inside the configured directory, including after symlink resolution. */
export function uploadPath(dir: string, candidate: unknown): string | null {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) return null;
  try {
    const root = realpathSync(dir);
    const file = realpathSync(candidate);
    const relative = path.relative(root, file);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !statSync(file).isFile()) return null;
    // The path as given, once its real one is proven inside: on macOS a temp folder's real path gains /private.
    return path.resolve(candidate);
  } catch {
    return null;
  }
}
