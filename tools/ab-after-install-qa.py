#!/usr/bin/env python3
"""Receipt-bound Mini QA. Always a separate follow-up; never an install rollback."""
import argparse, base64, fcntl, hashlib, importlib.util, io, json, os, pathlib, re, signal, subprocess, sys, tarfile, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mini', ROOT / 'tools/ab-mini-run.py')
mini = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mini)

def sha(data): return hashlib.sha256(data).hexdigest()

def run(args, **kw):
    return subprocess.check_output(args, timeout=180, env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}, **kw)

def git(root, *args): return run(['git', '-C', str(root), *args]).decode().strip()

def inventory(root):
    if root.is_symlink(): raise ValueError('artifact root symlink refused')
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink(): raise ValueError('artifact symlink refused')
        if path.is_file(): result[path.relative_to(root).as_posix()] = sha(path.read_bytes())
    return result

def companion_proof(file, source, revision):
    file = pathlib.Path(file); artifact = file.parent / 'world.html'
    if file.is_symlink() or artifact.is_symlink(): raise ValueError('companion symlinks refused')
    manifest_bytes = file.read_bytes(); html = artifact.read_bytes()
    if len(manifest_bytes) > 256 * 1024 or len(html) > 16 * 1024**2: raise ValueError('companion exceeds bounded size')
    manifest = json.loads(manifest_bytes)
    pins_bytes = run(['git', '-C', str(source), 'show', revision + ':tools/ab-estate-source.json'])
    producer = run(['git', '-C', str(source), 'show', revision + ':tools/ab-build-estate-fixture.mjs'])
    pins = json.loads(pins_bytes)
    if manifest.get('schema') != 1 or manifest.get('kind') != 'estate-synthetic-companion' or manifest.get('inputMode') != 'synthetic-only' or manifest.get('privateInputsRead') is not False:
        raise ValueError('unapproved companion mode')
    if manifest.get('sourceRevision') != pins['revision'] or manifest.get('sourceFiles') != pins['files'] or manifest.get('pinsSha256') != sha(pins_bytes) or manifest.get('producerSha256') != sha(producer):
        raise ValueError('companion differs from accepted source pins/producer')
    if manifest.get('artifact') != {'file': 'world.html', 'sha256': sha(html), 'bytes': len(html)}:
        raise ValueError('companion artifact hash mismatch')
    return {'sourceRevision': pins['revision'], 'files': {'manifest.json': sha(manifest_bytes), 'world.html': sha(html)}}

def validate(ns):
    revision = ns.revision
    acceptance = {}
    if ns.install_receipt:
        receipt_path = pathlib.Path(ns.install_receipt)
        install = json.loads(receipt_path.read_text())
        revision = install.get('merged_sha') or install.get('revision')
        if ns.revision and revision != ns.revision: raise ValueError('install/ship revision mismatch')
        if install.get('result') != 'installed' or install.get('after', {}).get('sha') != revision:
            raise ValueError('successful install with exact API readback required')
        acceptance_path = pathlib.Path(ns.acceptance or install['acceptance'])
        acceptance = json.loads(acceptance_path.read_text())
        accepted = acceptance['acceptedCommit']
        hashes = acceptance['distHashes']
        if any(install.get('newDistHashes', {}).get(k) != v for k, v in hashes.items()):
            raise ValueError('installed artifact differs from acceptance')
        evidence = {'installReceipt': str(receipt_path.resolve()), 'installReceiptHash': sha(receipt_path.read_bytes()),
                    'acceptanceHash': sha(acceptance_path.read_bytes())}
    elif ns.installed_dist and ns.readback_url:
        # Called only after ab-live's successful branch has disarmed its rollback trap.
        if not re.fullmatch(r'http://127\.0\.0\.1:\d+/api/version', ns.readback_url):
            raise ValueError('only local version readback allowed')
        with urllib.request.urlopen(ns.readback_url, timeout=5) as response: after = json.load(response)
        installed = pathlib.Path(ns.installed_dist)
        if after.get('sha') != revision or (installed / 'DEPLOYED_SHA').read_text().strip() != revision:
            raise ValueError('live version readback mismatch')
        hashes = inventory(pathlib.Path(ns.dist)); hashes.pop('DEPLOYED_SHA', None)
        live_hashes = inventory(installed); live_hashes.pop('DEPLOYED_SHA', None)
        if live_hashes != hashes: raise ValueError('live artifact differs from successful build')
        accepted = revision
        evidence = {'origin': 'ab-live-successful-build', 'after': after}
    else:
        return revision, None
    if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('full installed revision required')
    source, dist = pathlib.Path(ns.source), pathlib.Path(ns.dist)
    tree = git(source, 'rev-parse', revision + '^{tree}')
    if tree != git(source, 'rev-parse', accepted + '^{tree}'):
        raise ValueError('installed source tree differs from acceptance')
    actual = inventory(dist); actual.pop('DEPLOYED_SHA', None)
    expected = dict(hashes); expected.pop('DEPLOYED_SHA', None)
    if actual != expected or 'index.html' not in expected: raise ValueError('accepted artifact hash mismatch')
    companion = getattr(ns, 'companion_manifest', None)
    if companion or acceptance.get('estateCompanion'):
        if not companion or not ns.install_receipt: raise ValueError('accepted companion needs installed receipt and --companion-manifest')
        evidence['companion'] = companion_proof(companion, source, revision)
        if acceptance.get('estateCompanion') != evidence['companion']: raise ValueError('companion hashes are not accepted by release')
    return revision, {**evidence, 'revision': revision, 'sourceTree': tree, 'distHashes': expected}

def remote_source():
    # Only this small preparation function is transported; no runtime/config installation.
    import inspect
    return 'import base64,pathlib,hashlib,json,os,subprocess,sys,tarfile,io,fcntl,shutil,re\n' + inspect.getsource(remote_prepare)

def remote_prepare(payload):
    home = pathlib.Path.home()
    repo = home / 'SISO_Workspace/SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agent-base'
    state = home / '.local/state/agent-base/mini-delivery'
    env = {**os.environ, 'GIT_OPTIONAL_LOCKS': '0', 'PATH': str(home / '.local/bin') + ':/opt/homebrew/bin:/usr/local/bin:' + os.environ.get('PATH', '')}
    def cmd(*args): return subprocess.check_output(list(args), env=env, timeout=180).decode().strip()
    def g(*args): return cmd('git', '-C', str(repo), *args)
    def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
    def snapshot():
        index = pathlib.Path(g('rev-parse', '--path-format=absolute', '--git-path', 'index'))
        return {'head': g('rev-parse', 'HEAD'), 'status': g('status', '--porcelain', '--untracked-files=all'), 'index': digest(index)}
    if 'probe' in payload:
        heads = [r[5:] for r in g('worktree', 'list', '--porcelain').splitlines() if r.startswith('HEAD ')]
        revision = payload['probe']
        prior = state / ('qa-' + revision + '.json')
        old = json.loads(prior.read_text()) if prior.exists() else {}
        preparation = state / ('preparation-' + revision) / 'receipt.json'
        proof = json.loads(preparation.read_text()) if preparation.exists() else None
        present = subprocess.run(['git', '-C', str(repo), 'cat-file', '-e', revision + '^{commit}'], capture_output=True, env=env, timeout=20).returncode == 0
        return {'heads': sorted(set(heads)), 'home': str(home), 'present': present, 'existing': old if old.get('started') else None, 'preparation': proof}
    revision = payload['revision']; target = home / 'SISO_Workspace/_data/worktrees/siso-internal-labs-agent-base' / ('qa-' + revision)
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'admission.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        prior = state / ('qa-' + revision + '.json')
        if prior.exists() and json.loads(prior.read_text()).get('started'):
            previous_path = state / ('preparation-' + revision) / 'receipt.json'
            previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
            if previous.get('sourceTree') != payload['sourceTree'] or previous.get('distHashes') != payload['distHashes'] or previous.get('companion') != payload.get('companion'):
                raise ValueError('existing Mini attempt preserved; preparation evidence mismatch')
            return {'existing': json.loads(prior.read_text()), 'mirror': str(target)}
        before = snapshot()
        owned = state / ('preparation-' + revision)
        if owned.exists() or target.exists(): raise ValueError('existing preparation/mirror preserved; owner recovery required')
        if shutil.disk_usage(home).free < 10 * 1024**3: raise ValueError('disk free below 10 GiB')
        vm = cmd('vm_stat'); page = int(re.search(r'page size of (\d+)', vm).group(1))
        available = sum(int(re.search(r'^' + key + r':\s+(\d+)', vm, re.M).group(1)) for key in ['Pages free', 'Pages inactive', 'Pages speculative']) * page
        if available < 2 * 1024**3: raise ValueError('available memory below 2 GiB')
        owned.mkdir()
        (owned / 'ownership.json').write_text(json.dumps({'revision': revision, 'sourceTree': payload['sourceTree'], 'distHashes': payload['distHashes'], 'companion': payload.get('companion'), 'before': before}))
        try:
            # Explicit member allowlist; no extractall, links or unowned writes.
            archive = tarfile.open(fileobj=io.BytesIO(base64.b64decode(payload['archive'])))
            allowed = ({'source.bundle'} if payload['bundleHash'] else set()) | {'dist/' + p for p in payload['distHashes']}
            companion = payload.get('companion')
            if companion:
                if set(companion['files']) != {'world.html', 'manifest.json'}: raise ValueError('unexpected companion members')
                allowed |= {'companion/' + p for p in companion['files']}
            members = archive.getmembers()
            if len(members) != len(allowed) or {m.name for m in members} != allowed: raise ValueError('unexpected archive members')
            if sum(m.size for m in members) > 512 * 1024**2: raise ValueError('archive exceeds bounded preparation size')
            for member in members:
                if not member.isfile() or '..' in pathlib.PurePosixPath(member.name).parts or member.name.startswith('/'):
                    raise ValueError('unsafe archive member')
                dest = owned / member.name; dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(archive.extractfile(member).read())
            if payload['bundleHash']:
                bundle = owned / 'source.bundle'
                if digest(bundle) != payload['bundleHash']: raise ValueError('bundle hash mismatch')
                g('bundle', 'verify', str(bundle))
                ref = 'refs/mini-delivery/' + revision
                g('-c', 'gc.auto=0', 'fetch', '--no-tags', '--no-write-fetch-head', str(bundle), ref + ':' + ref)
            if g('rev-parse', revision + '^{tree}') != payload['sourceTree']: raise ValueError('source tree mismatch')
            if any(row.startswith('120000 ') for row in g('ls-tree', '-r', revision).splitlines()):
                raise ValueError('source symlinks refused')
            g('-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', str(target), revision)
            dest = target / 'apps/web/dist'
            if dest.exists(): raise ValueError('tracked or unexpected dist preserved')
            for name, expected in payload['distHashes'].items():
                path = owned / 'dist' / name
                if digest(path) != expected: raise ValueError('artifact hash mismatch')
            shutil.copytree(owned / 'dist', dest)
            (dest / 'DEPLOYED_SHA').write_text(revision + '\n')
            if companion:
                for name, expected in companion['files'].items():
                    if digest(owned / 'companion' / name) != expected: raise ValueError('companion transfer hash mismatch')
                companion_dest = target / '.qa-estate'
                if companion_dest.exists(): raise ValueError('existing companion directory preserved')
                shutil.copytree(owned / 'companion', companion_dest)
            if cmd('git', '-C', str(target), 'status', '--porcelain', '--untracked-files=no'):
                raise ValueError('mirror tracked files changed')
            return {'mirror': str(target), 'preparation': str(owned / 'receipt.json')}
        finally:
            after = snapshot()
            (owned / 'receipt.json').write_text(json.dumps({'revision': revision, 'sourceTree': payload['sourceTree'], 'distHashes': payload['distHashes'], 'companion': payload.get('companion'), 'before': before, 'after': after, 'preserved': before == after}, indent=2))
            if before != after: raise ValueError('canonical checkout changed; stop and inspect preservation receipt')

def ssh_call(host, payload):
    source = remote_source()
    source += '\nprint(json.dumps(remote_prepare(json.load(sys.stdin))))\n'
    encoded = base64.b64encode(source.encode()).decode()
    remote = "python3 -c \"import base64;exec(base64.b64decode('" + encoded + "'))\""
    data = run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', '-o', 'RequestTTY=no', '-o', 'RemoteCommand=none', host, remote], input=json.dumps(payload).encode())
    return json.loads(data.decode().strip().splitlines()[-1])

def prepare(ns, proof, directory):
    revision = proof['revision']; source = pathlib.Path(ns.source)
    remote = ssh_call(ns.host, {'probe': revision})
    if remote.get('existing'):
        old = remote.get('preparation') or {}
        if old.get('sourceTree') != proof['sourceTree'] or old.get('distHashes') != proof['distHashes'] or old.get('companion') != proof.get('companion'):
            raise ValueError('existing Mini attempt preserved; matching preparation provenance unavailable')
        return {'existing': remote['existing']}
    excludes = []
    for head in remote['heads']:
        if re.fullmatch(r'[a-f0-9]{40}', head):
            present = subprocess.run(['git', '-C', str(source), 'cat-file', '-e', head + '^{commit}'], capture_output=True).returncode == 0
            if present: excludes.append('^' + head)
    bundle = directory / 'source.bundle'
    if not remote['present']:
        ref = 'refs/mini-delivery/' + revision
        git(source, 'update-ref', ref, revision)
        git(source, 'bundle', 'create', str(bundle), ref, *excludes)
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode='w:gz') as tar:
        if bundle.exists(): tar.add(bundle, arcname='source.bundle', recursive=False)
        for name in proof['distHashes']:
            tar.add(pathlib.Path(ns.dist) / name, arcname='dist/' + name, recursive=False)
        if proof.get('companion'):
            for name in proof['companion']['files']:
                tar.add(pathlib.Path(ns.companion_manifest).parent / name, arcname='companion/' + name, recursive=False)
    if archive.tell() > 128 * 1024**2: raise ValueError('transfer exceeds 128 MiB; owner must prepare a smaller incremental bundle')
    return ssh_call(ns.host, {**proof, 'bundleHash': sha(bundle.read_bytes()) if bundle.exists() else None, 'archive': base64.b64encode(archive.getvalue()).decode()})

def trigger(ns, preparer=prepare, transport=mini.transport):
    revision, proof = validate(ns)
    if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}', revision): raise ValueError('full revision required')
    state = pathlib.Path(ns.state); state.mkdir(parents=True, exist_ok=True)
    path = state / ('after-install-' + revision + '.json')
    with (state / ('after-install-' + revision + '.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old = json.loads(path.read_text()) if path.exists() else {}
        if old.get('started'):
            if proof and old.get('fingerprint') != mini.digest(proof): raise ValueError('install evidence conflict; existing receipt preserved')
            if old['state'] == 'running':
                old.update(state='unknown', reason='Hook interrupted; inspect remote qa receipt before recovery')
                mini.save(path, old)
            return {**old, 'reused': True}
        result = {'revision': revision, 'installResult': 'installed' if proof else 'unverified', 'state': 'deferred', 'started': False, 'receiptPath': str(path)}
        if proof:
            result.update(state='running', started=True, fingerprint=mini.digest(proof), evidence=proof)
            mini.save(path, result)
            try:
                directory = state / ('after-install-' + revision); directory.mkdir(exist_ok=False)
                prepared = preparer(ns, proof, directory)
                if prepared.get('existing'):
                    qa = prepared['existing']
                else:
                    payload = {'kind': 'qa', 'identity': 'qa-' + revision, 'revision': revision, 'mirror': prepared['mirror']}
                    if proof.get('companion'): payload['companion'] = proof['companion']
                    qa = transport(payload, ns.host)
                if qa.get('revision') != revision: raise ValueError('QA receipt revision mismatch')
                result.update(state=qa['state'], qa=qa, preparation=prepared.get('preparation'))
            except Exception as exc: result.update(state='blocked', reason=str(exc))
        else: result['reason'] = 'Ship recorded; waiting for verified installation and accepted artifact'
        mini.save(path, result)
        return result

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--revision'); p.add_argument('--install-receipt'); p.add_argument('--acceptance')
    p.add_argument('--source', default=str(ROOT)); p.add_argument('--dist', default=str(ROOT / 'apps/web/dist'))
    p.add_argument('--installed-dist'); p.add_argument('--readback-url')
    p.add_argument('--companion-manifest', help='Synthetic Estate manifest whose hashes are frozen in acceptance.estateCompanion')
    p.add_argument('--host', default='mac-mini-herdr')
    p.add_argument('--state', default=str(pathlib.Path.home() / '.local/state/agent-base/mini-delivery'))
    ns = p.parse_args()
    if ns.host.startswith('-') or not re.fullmatch(r'[a-zA-Z0-9_.@-]+', ns.host): p.error('invalid SSH host')
    def expired(_signum, _frame): raise TimeoutError('post-install follow-up exceeded 20-minute deadline; inspect preserved remote receipt')
    previous = signal.signal(signal.SIGALRM, expired); signal.alarm(1200)
    try: result = trigger(ns)
    except Exception as exc:
        result = {'state': 'blocked', 'reason': str(exc), 'revision': ns.revision, 'installResult': 'unchanged'}
        try:
            state = pathlib.Path(ns.state)
            mini.save(state / ('follow-up-error-' + sha(json.dumps(vars(ns), sort_keys=True).encode())[:16] + '.json'), result)
        except OSError: pass
    finally:
        signal.alarm(0); signal.signal(signal.SIGALRM, previous)
    print(json.dumps(result))
    # An accepted healthy installation always remains successful; QA status is separate.
    return 0

if __name__ == '__main__': sys.exit(main())
