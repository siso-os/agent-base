import { lstatSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type RecordData = Record<string, any>;
export type ComponentCatalog = RecordData & { components: (RecordData & { id: string })[] };
export const defaultHubRoot = path.resolve(import.meta.dirname, '../../../ui-hub');
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z_][a-z0-9_-]{0,79}$/.test(id);
const isObject = (value: unknown): value is RecordData => !!value && typeof value === 'object' && !Array.isArray(value);

// Catalog paths are constructed only from validated IDs and fixed filenames.
function catalogPath(root: string, relative: string): string {
  const absolute = path.resolve(root, relative);
  let checked = path.parse(absolute).root;
  for (const part of absolute.slice(checked.length).split(path.sep)) {
    checked = path.join(checked, part);
    try { if (lstatSync(checked).isSymbolicLink()) throw new Error('Symbolic links are not catalog files'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}
function readRecord(file: string): RecordData {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 256_000) throw new Error('Invalid or oversized catalog record');
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isObject(value)) throw new Error('Catalog record must be an object');
  return value;
}
function validateRecord(record: RecordData, expectedId?: string) {
  if (!validId(record.id) || (expectedId !== undefined && record.id !== expectedId)) throw new Error('Invalid or mismatched component ID');
  for (const key of ['pages', 'proofRefs']) {
    if (record[key] === undefined) continue;
    if (!Array.isArray(record[key])) throw new Error(`Invalid ${key} in ${record.id}`);
    const seen = new Set<string>();
    for (const entry of record[key]) {
      if (!isObject(entry) || !validId(entry.id) || seen.has(entry.id)) throw new Error(`Invalid or duplicate ${key} ID in ${record.id}`);
      seen.add(entry.id);
      if (key === 'proofRefs' && !validId(entry.component)) throw new Error('Invalid proof component ID');
      const file = entry.file;
      if (typeof file !== 'string' || file.length > 500 || !file || file.replace(/\/$/, '').split('/').some(part => !part || part === '.' || part === '..' || !/^[\w .()-]+$/.test(part))) throw new Error(`Invalid catalog path in ${record.id}`);
    }
  }
}

/** Existing order and envelope metadata survive. A component manifest overrides only its own row. */
export function readComponentCatalog(root = defaultHubRoot): ComponentCatalog {
  const legacy = readRecord(catalogPath(root, 'components.json'));
  if (!Array.isArray(legacy.components) || legacy.components.length > 150) throw new Error('Invalid component catalog');
  const rows = new Map<string, RecordData & { id: string }>();
  for (const record of legacy.components) {
    if (!isObject(record)) throw new Error('Invalid component record');
    validateRecord(record);
    if (rows.has(record.id)) throw new Error(`Duplicate component ID: ${record.id}`);
    rows.set(record.id, record as RecordData & { id: string });
  }
  // The baseline above retains legacy-only components during incremental adoption.
  const directories = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const directory of directories) {
    if (directory.isSymbolicLink()) {
      if (rows.has(directory.name)) throw new Error('Symbolic links are not catalog directories');
      continue; // Never discover manifests through links to unregistered directories.
    }
    if (!directory.isDirectory()) continue;
    let file: string;
    try {
      file = catalogPath(root, `${directory.name}/component.json`);
      lstatSync(file);
    } catch (error: any) { if (error.code === 'ENOENT') continue; throw error; }
    if (!validId(directory.name)) throw new Error('Invalid component directory ID');
    const manifest = readRecord(file);
    validateRecord(manifest, directory.name);
    // Retain unknown legacy fields when a new owner supplies a partial manifest.
    const merged = { ...rows.get(directory.name), ...manifest } as RecordData & { id: string };
    validateRecord(merged);
    rows.set(directory.name, merged);
  }
  if (rows.size > 150) throw new Error('Too many catalog components');
  return { ...legacy, components: [...rows.values()] };
}

/** Explicit compatibility export for hub.js and static consumers; never rewrites manifests. */
export function syncComponentCatalog(root = defaultHubRoot, check = false) {
  const file = catalogPath(root, 'components.json');
  const before = readFileSync(file, 'utf8');
  const catalog = readComponentCatalog(root);
  const encoded = JSON.stringify(catalog, null, 2) + '\n';
  if (Buffer.byteLength(encoded) > 256_000) throw new Error('Catalog export is too large');
  const changed = before !== encoded;
  if (changed && !check) {
    // Do not knowingly overwrite a concurrent edit of the compatibility file.
    if (readFileSync(file, 'utf8') !== before) throw new Error('Catalog changed during sync; retry');
    const temporary = catalogPath(root, `components-${randomUUID()}.tmp`);
    writeFileSync(temporary, encoded, { flag: 'wx', mode: 0o644 });
    renameSync(temporary, file);
  }
  return { changed, components: catalog.components.length };
}
