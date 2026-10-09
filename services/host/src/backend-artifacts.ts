/** Retained snapshots of an already installed Codex package. No installer or network transport. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, renameSync, statfsSync, unlinkSync, writeFileSync, writeSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';

export type BundleReference = { manifest: string; sha256: string };
export type LocalBackendArtifact = { provider: 'codex'; version: string; executable: string; sha256: string; bundle?: BundleReference };
export type BackendCatalog = { schema: 1; revision: number; artifacts: (LocalBackendArtifact & { id: string })[] };
type FileEntry = { path: string; bytes: number; mode: number; sha256: string };
type Bundle = { schema: 1; provider: 'codex'; version: string; target: string; entrypoint: string; resourcesDir: string; pathDir: string; files: FileEntry[] };
const MANIFEST = '.backend-provenance.json';
const VERSION = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const SHA = /^[a-f0-9]{64}$/;
export const backendCatalogFile = () => process.env.AB_BACKEND_CATALOG ?? path.join(homedir(), '.local/state/agent-base/backend-catalog.json');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const trustedUid = (uid: number) => uid === 0 || uid === process.getuid?.();
export function privateBackendText(file: string) {
  const stat = lstatSync(file), parent = lstatSync(path.dirname(file));
  if (!path.isAbsolute(file) || realpathSync(file) !== file || !stat.isFile() || !parent.isDirectory() || stat.mode & 0o077 || parent.mode & 0o022 || !trustedUid(stat.uid) || !trustedUid(parent.uid) || stat.size > 1024 * 1024) throw Error('Private backend file ownership is invalid');
  return readFileSync(file, 'utf8');
}
export function readBackendCatalog(file = backendCatalogFile()) {
  const text = privateBackendText(file), value = JSON.parse(text) as BackendCatalog;
  if (!value || typeof value !== 'object' || value.schema !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Array.isArray(value.artifacts) || value.artifacts.length > 256) throw Error('Invalid backend catalog');
  const ids = new Set<string>();
  for (const a of value.artifacts) {
    if (!a || typeof a.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(a.id) || ids.has(a.id) || a.provider !== 'codex' || !VERSION.test(a.version) || !SHA.test(a.sha256) || typeof a.executable !== 'string' || !path.isAbsolute(a.executable) || a.bundle && (typeof a.bundle.manifest !== 'string' || !path.isAbsolute(a.bundle.manifest) || !SHA.test(a.bundle.sha256))) throw Error('Invalid backend catalog artifact');
    ids.add(a.id);
  }
  return { value, fingerprint: hash(text) };
}
function relative(file: string) {
  if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.includes('\\') || file.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Unsafe backend bundle path');
  return file;
}
function protectedDirectory(dir: string, create = false) {
  if (!path.isAbsolute(dir) || path.resolve(dir) !== dir) throw Error('Canonical backend directory required');
  if (create) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const s = lstatSync(dir);
  if (realpathSync(dir) !== dir || !s.isDirectory() || s.mode & 0o022 || !trustedUid(s.uid)) throw Error('Backend directory ownership is invalid');
}
function fileHash(file: string, destination?: string): { bytes: number; sha256: string; mode: number } {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW), output = destination ? openSync(destination, 'wx', 0o600) : undefined;
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.mode & 0o022 || !trustedUid(before.uid) || before.size > 512 * 1024 * 1024) throw Error('Unsafe backend bundle file');
    const h = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024); let bytes = 0, length;
    while ((length = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      bytes += length; h.update(buffer.subarray(0, length));
      if (output !== undefined) { let offset = 0; while (offset < length) offset += writeSync(output, buffer, offset, length - offset); }
    }
    const after = fstatSync(fd), current = lstatSync(file);
    if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== current.ino || before.dev !== current.dev || current.isSymbolicLink()) throw Error('Backend source changed during snapshot');
    if (output !== undefined) fsyncSync(output);
    return { bytes, sha256: h.digest('hex'), mode: before.mode & 0o111 ? 0o555 : 0o444 };
  } finally { closeSync(fd); if (output !== undefined) closeSync(output); }
}
function tree(root: string, destination?: string, retained = false) {
  protectedDirectory(root); const files: FileEntry[] = []; let total = 0;
  const walk = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (!prefix && entry.name === MANIFEST && retained) continue;
      const name = relative(prefix ? `${prefix}/${entry.name}` : entry.name), source = path.join(root, name), s = lstatSync(source);
      if (s.isSymbolicLink()) throw Error('Backend bundle symlinks are unsupported');
      if (s.isDirectory()) { protectedDirectory(source); if (destination) mkdirSync(path.join(destination, name), { mode: 0o700 }); walk(source, name); }
      else if (s.isFile()) {
        if (files.length >= 4096 || name === MANIFEST) throw Error('Backend bundle inventory is invalid');
        const data = fileHash(source, destination ? path.join(destination, name) : undefined); total += data.bytes;
        if (total > 2 * 1024 ** 3) throw Error('Backend bundle exceeds snapshot limit');
        if (destination) chmodSync(path.join(destination, name), data.mode);
        files.push({ path: name, ...data });
      } else throw Error('Backend bundle special files are unsupported');
    }
  };
  walk(root); return files;
}
export function nativeBackendTarget() {
  const targets: Record<string, string> = { 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin', 'linux-arm64': 'aarch64-unknown-linux-musl', 'linux-x64': 'x86_64-unknown-linux-musl' };
  const target = targets[`${process.platform}-${process.arch}`];
  if (!target) throw Error('Unsupported local backend platform'); return target;
}
function nativeArchitecture(file: string) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW), b = Buffer.alloc(24);
  try { readSync(fd, b, 0, b.length, 0); } finally { closeSync(fd); }
  if (process.platform === 'darwin' && b.readUInt32LE(0) === 0xfeedfacf && b.readUInt32LE(4) === (process.arch === 'arm64' ? 0x100000c : 0x1000007)) return;
  if (process.platform === 'linux' && b.subarray(0,4).toString('hex') === '7f454c46' && b[4] === 2 && b[5] === 1 && b.readUInt16LE(18) === (process.arch === 'arm64' ? 183 : 62)) return;
  throw Error('Backend binary architecture does not match this machine');
}

/** Rehash the entire retained layout, including resources and executable sidecars. */
export function verifyBackendBundle(artifact: LocalBackendArtifact) {
  if (!artifact.bundle) return null;
  const envelope = JSON.parse(privateBackendText(artifact.bundle.manifest)), bundle = envelope.bundle as Bundle;
  if (envelope.schema !== 1 || !bundle || bundle.schema !== 1 || bundle.provider !== 'codex' || bundle.version !== artifact.version || bundle.target !== nativeBackendTarget() || !Array.isArray(bundle.files) || !bundle.files.length || hash(JSON.stringify(bundle)) !== artifact.bundle.sha256 || envelope.digest !== artifact.bundle.sha256) throw Error('Backend bundle manifest changed');
  const root = path.dirname(artifact.bundle.manifest);
  if (artifact.executable !== path.join(root, relative(bundle.entrypoint))) throw Error('Backend bundle entrypoint changed');
  for (const dir of [bundle.resourcesDir, bundle.pathDir]) protectedDirectory(path.join(root, relative(dir)));
  const observed = tree(root, undefined, true);
  if (JSON.stringify(observed) !== JSON.stringify(bundle.files)) throw Error('Backend bundle contents changed');
  if (bundle.files.find(f => f.path === bundle.entrypoint)?.sha256 !== artifact.sha256) throw Error('Backend executable is outside its retained bundle');
  nativeArchitecture(artifact.executable);
  return { digest: artifact.bundle.sha256, target: bundle.target, files: bundle.files.length };
}

/** Explicit administrator operation; preserves original package, old artifacts and old catalogs. */
export function provisionLocalCodex(options: { sourcePackage: string; artifactsDir: string; catalogFile: string; expectedCatalogRevision: number }) {
  protectedDirectory(options.sourcePackage); protectedDirectory(options.artifactsDir, true); protectedDirectory(path.dirname(options.catalogFile), true);
  if (!path.isAbsolute(options.catalogFile) || path.resolve(options.catalogFile) !== options.catalogFile || !Number.isSafeInteger(options.expectedCatalogRevision) || options.expectedCatalogRevision < 0) throw Error('Explicit private catalog path and revision required');
  const parentFile = path.join(options.sourcePackage, 'package.json'), parentText = readFileSync(parentFile, 'utf8'), parent = JSON.parse(parentText);
  const platformName = `@openai/codex-${process.platform}-${process.arch}`, platformFile = createRequire(parentFile).resolve(`${platformName}/package.json`);
  const platformText = readFileSync(platformFile, 'utf8'), platform = JSON.parse(platformText), target = nativeBackendTarget();
  const root = path.join(path.dirname(platformFile), 'vendor', target), layoutFile = path.join(root, 'codex-package.json'), layoutText = readFileSync(layoutFile, 'utf8'), layout = JSON.parse(layoutText);
  if (parent.name !== '@openai/codex' || !VERSION.test(parent.version) || parent.optionalDependencies?.[platformName] !== `npm:@openai/codex@${parent.version}-${process.platform}-${process.arch}` || platform.version !== `${parent.version}-${process.platform}-${process.arch}` || !platform.os?.includes(process.platform) || !platform.cpu?.includes(process.arch) || layout.layoutVersion !== 1 || layout.version !== parent.version || layout.target !== target || layout.variant !== 'codex') throw Error('Installed backend package provenance disagrees');
  relative(layout.entrypoint); relative(layout.resourcesDir); relative(layout.pathDir);
  for (const dir of [layout.resourcesDir, layout.pathDir]) protectedDirectory(path.join(root, dir));
  nativeArchitecture(path.join(root, layout.entrypoint));
  if (!(lstatSync(path.join(root, layout.entrypoint)).mode & 0o111)) throw Error('Backend entrypoint is not executable');
  const files = tree(root), bundle: Bundle = { schema: 1, provider: 'codex', version: parent.version, target, entrypoint: layout.entrypoint, resourcesDir: layout.resourcesDir, pathDir: layout.pathDir, files };
  const digest = hash(JSON.stringify(bundle)), id = `codex-${parent.version.replace(/[^A-Za-z0-9_-]/g,'-')}-${digest.slice(0,24)}`;
  const bytes = files.reduce((n,f) => n + f.bytes, 0), disk = statfsSync(options.artifactsDir);
  if (disk.bavail * disk.bsize < bytes + 64 * 1024 * 1024) throw Error('Insufficient free space for a retained backend snapshot');
  const lock = `${options.catalogFile}.lock`, token = randomUUID();
  writeFileSync(lock, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
  let stage: string | undefined;
  try {
    const original = existsSync(options.catalogFile) ? readBackendCatalog(options.catalogFile) : null, current = original?.value ?? null;
    if ((current?.revision ?? 0) !== options.expectedCatalogRevision) throw Error('Backend catalog revision changed');
    const directory = path.join(options.artifactsDir, id), artifact: LocalBackendArtifact & {id: string} = { id, provider: 'codex', version: parent.version, executable: path.join(directory, layout.entrypoint), sha256: files.find(f => f.path === layout.entrypoint)!.sha256, bundle: { manifest: path.join(directory, MANIFEST), sha256: digest } };
    const same = current?.artifacts.find(a => a.id === id);
    if (same) { if (JSON.stringify(same) !== JSON.stringify(artifact)) throw Error('Catalog identity changed'); verifyBackendBundle(same); return { artifact: same, catalogRevision: current!.revision, changed: false, downloaded: false }; }
    if ((current?.artifacts.length ?? 0) >= 256) throw Error('Backend catalog limit reached; retained versions require owner review');
    if (!existsSync(directory)) {
      stage = path.join(options.artifactsDir, `.stage-${randomUUID()}`); mkdirSync(stage, { mode: 0o700 });
      if (JSON.stringify(tree(root, stage)) !== JSON.stringify(files) || JSON.stringify(tree(root)) !== JSON.stringify(files) || readFileSync(parentFile,'utf8') !== parentText || readFileSync(platformFile,'utf8') !== platformText || readFileSync(layoutFile,'utf8') !== layoutText) throw Error('Installed backend changed while staging');
      writeFileSync(path.join(stage, MANIFEST), JSON.stringify({ schema: 1, bundle, digest, provenance: { origin: 'existing-local-installed-package', downloadedAt: null, stagedAt: new Date().toISOString(), sourcePackage: options.sourcePackage, parentPackageSha256: hash(parentText), platformPackageSha256: hash(platformText), layoutSha256: hash(layoutText), upstreamVerified: false } }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      verifyBackendBundle({ ...artifact, executable: path.join(stage, layout.entrypoint), bundle: { ...artifact.bundle!, manifest: path.join(stage, MANIFEST) } });
      renameSync(stage, directory); stage = undefined;
    } else verifyBackendBundle(artifact);
    if (existsSync(options.catalogFile) !== !!original || original && readBackendCatalog(options.catalogFile).fingerprint !== original.fingerprint) throw Error('Backend catalog changed while staging');
    if (current) {
      const history = `${options.catalogFile}.revision-${current.revision}.json`, old = privateBackendText(options.catalogFile);
      if (existsSync(history)) { if (privateBackendText(history) !== old) throw Error('Retained catalog history differs'); }
      else writeFileSync(history, old, { mode: 0o600, flag: 'wx' });
    }
    const next: BackendCatalog = { schema: 1, revision: (current?.revision ?? 0) + 1, artifacts: [...(current?.artifacts ?? []), artifact] };
    const temp = `${options.catalogFile}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temp, options.catalogFile);
    return { artifact, catalogRevision: next.revision, changed: true, downloaded: false };
  } catch (error) {
    if (stage) writeFileSync(path.join(stage, '.failed.json'), JSON.stringify({ failedAt: new Date().toISOString(), reason: 'Snapshot incomplete; retained for owner inspection' }), { mode: 0o600, flag: 'wx' });
    throw error;
  } finally { if (JSON.parse(readFileSync(lock,'utf8')).token === token) unlinkSync(lock); }
}
