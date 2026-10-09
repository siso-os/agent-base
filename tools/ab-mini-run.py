#!/usr/bin/env python3
"""Bounded, receipt-backed Mini jobs. No herdr, live sockets, fetch/pull or restarts."""
import argparse, base64, fcntl, hashlib, json, os, pathlib, re, shutil, signal, socket, subprocess, sys, time
ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = 'SISO_Workspace/SISO_Agency/apps/siso-internal-labs/siso-internal-labs-agent-base'
WORKTREES = 'SISO_Workspace/_data/worktrees/siso-internal-labs-agent-base'

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, indent=2) + '\n')
    os.replace(tmp, path)

def command(args, **kwargs):
    return subprocess.check_output(args, text=True, timeout=20, **kwargs).strip()

def resource_check(home):
    free = shutil.disk_usage(home).free
    if free < 10 * 1024**3:
        raise RuntimeError('blocked: disk free below 10 GiB')
    # macOS admission: free + inactive + speculative pages, never total RAM.
    raw = command(['vm_stat'])
    page = int(re.search(r'page size of (\d+)', raw).group(1))
    available = sum(int(re.search(r'^' + key + r':\s+(\d+)', raw, re.M).group(1)) for key in ['Pages free', 'Pages inactive', 'Pages speculative']) * page
    if available < 2 * 1024**3:
        raise RuntimeError('blocked: available memory below 2 GiB')
    return {'freeDiskBytes': free, 'availableMemoryBytes': available}

def remote(payload):
    home = pathlib.Path.home()
    os.environ['PATH'] = str(home / '.local/bin') + ':/opt/homebrew/bin:/usr/local/bin:' + os.environ.get('PATH', '')
    repo = home / REPO
    state = home / '.local/state/agent-base/mini-delivery'
    identity = payload['identity']
    if not re.fullmatch(r'[a-z0-9-]{1,100}', identity):
        raise ValueError('invalid identity')
    state.mkdir(parents=True, exist_ok=True)
    receipt_path = state / (identity + '.json')
    fingerprint = digest(payload)
    receipt = {'schema': 1, 'identity': identity, 'machine': 'mini', 'hostname': socket.gethostname(), 'revision': payload['revision'], 'fingerprint': fingerprint, 'kind': payload['kind'], 'state': 'blocked', 'started': False, 'receiptPath': str(receipt_path)}
    # Kernel-held admission lock releases on exit/crash. Never remove another run's lock.
    with (state / 'admission.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {**receipt, 'reason': 'Mini delivery admission busy; existing run preserved'}
        if receipt_path.exists():
            old = json.loads(receipt_path.read_text())
            if old['fingerprint'] != fingerprint:
                return {**receipt, 'reason': 'identity conflict; preserve existing receipt/workspace'}
            if old.get('started') or old['state'] in ['passed', 'failed', 'running', 'unknown']:
                # Losing SSH never authorizes a duplicate. Running after lock release means interrupted/unknown.
                if old['state'] == 'running':
                    old.update(state='unknown', reason='Previous supervisor interrupted; inspect receipt/log before a new task identity')
                    save(receipt_path, old)
                return {**old, 'reused': True}
        try:
            for prior in state.glob('*.json'):
                previous = json.loads(prior.read_text())
                if previous.get('state') in ['running', 'unknown'] and previous.get('started'):
                    raise RuntimeError('Unresolved prior Mini run; owner must inspect its receipt before admission')
            receipt['resources'] = resource_check(home)
            if command(['git', '-C', str(repo), 'rev-parse', payload['revision'] + '^{commit}']) != payload['revision']:
                raise RuntimeError('revision is not present on Mini; owner must sync it')
            heavy = shutil.which('heavy')
            if not heavy:
                raise RuntimeError('heavy admission helper unavailable')
            if payload['kind'] == 'ui-soul':
                routing = home / 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/routing.json'
                policy = json.loads(routing.read_text())
                if policy.get('roles_model') != payload['model']:
                    raise RuntimeError('Mini routing differs; owner must reconcile routing before launch')
                launcher = shutil.which('codex-run')
                if not launcher:
                    raise RuntimeError('codex-run unavailable')
                workspace = home / WORKTREES / identity
                receipt['workspace'] = str(workspace)
                if workspace.exists():
                    # Unreceipted folders are owned by someone else. Never adopt or overwrite them.
                    raise RuntimeError('workspace already exists; manual recovery required')
                command(['git', '-C', str(repo), 'worktree', 'add', '-b', 'codex/' + identity, str(workspace), payload['revision']])
                brief = workspace / '.ui-soul-brief.md'
                brief.write_text(payload['brief'])
                args = [heavy, '--', launcher, '--as', payload['name'], '--workspace', identity, '--parent', 'AGENT-BASE', '--task', payload['task'], '-m', payload['model'], '-e', 'high', '-C', str(workspace), str(brief)]
            else:
                workspace = pathlib.Path(payload['mirror']).expanduser().resolve()
                allowed = (home / WORKTREES).resolve()
                if allowed not in workspace.parents or not workspace.name.startswith('qa-'):
                    raise RuntimeError('QA requires a dedicated qa-* mirror under the worktree estate')
                receipt['workspace'] = str(workspace)
                if command(['git', '-C', str(workspace), 'rev-parse', 'HEAD']) != payload['revision']:
                    raise RuntimeError('QA mirror HEAD does not match successful ship')
                if command(['git', '-C', str(workspace), 'status', '--porcelain', '--untracked-files=no']):
                    raise RuntimeError('QA mirror tracked files are dirty')
                marker = workspace / 'apps/web/dist/DEPLOYED_SHA'
                if marker.read_text().strip() != payload['revision']:
                    raise RuntimeError('QA built revision marker does not match successful ship')
                runner = workspace / 'tools/ab-qa-walk.mjs'
                if not runner.is_file():
                    raise RuntimeError('QA walker missing from mirror')
                out = state / identity
                out.mkdir(exist_ok=True)
                args = [heavy, '--', 'node', str(runner), '--revision', payload['revision'], '--out', str(out)]
                companion = payload.get('companion')
                if companion:
                    directory = workspace / '.qa-estate'
                    if directory.is_symlink() or set(companion.get('files', {})) != {'manifest.json', 'world.html'}:
                        raise RuntimeError('unapproved companion path/member set')
                    for name, expected in companion['files'].items():
                        file = directory / name
                        if file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
                            raise RuntimeError('companion hash mismatch')
                    manifest = json.loads((directory / 'manifest.json').read_text())
                    if manifest.get('sourceRevision') != companion['sourceRevision']:
                        raise RuntimeError('companion source revision mismatch')
                    args += ['--companion-manifest', str(directory / 'manifest.json')]
                    receipt['companion'] = companion
            receipt.update(state='running', started=True, startedAt=time.time(), model=payload.get('model'), effort='high' if payload['kind'] == 'ui-soul' else None)
            log_path = state / (identity + '.log')
            receipt['logPath'] = str(log_path)
            save(receipt_path, receipt)
            with log_path.open('ab') as log:
                # Only terminate this owned process group, never existing agents.
                child = subprocess.Popen(args, cwd=workspace, stdout=log, stderr=log, start_new_session=True)
                receipt['pid'] = child.pid
                save(receipt_path, receipt)
                try:
                    code = child.wait(timeout=3600 if payload['kind'] == 'ui-soul' else 600)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGTERM)
                    try: child.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
                    raise RuntimeError('owned run exceeded deadline')
            receipt.update(state='passed' if code == 0 else 'failed', exitCode=code, finishedAt=time.time())
            if payload['kind'] == 'qa':
                walk_path = out / 'walk.json'
                if not walk_path.exists():
                    raise RuntimeError('QA exited without walk receipt')
                walk = json.loads(walk_path.read_text())
                receipt.update(walkReceipt=str(walk_path), routes=walk.get('routes'), bugs=walk.get('bugs'), state=walk.get('state') if code == 0 or walk.get('state') in ['blocked', 'failed'] else 'failed')
                if walk.get('companion'): receipt['companionRendered'] = walk['companion']
                if receipt['state'] not in ['passed', 'failed', 'blocked']:
                    raise RuntimeError('invalid walk state')
        except Exception as exc:
            receipt.update(state='failed' if receipt['started'] else 'blocked', reason=str(exc), finishedAt=time.time())
        save(receipt_path, receipt)
        return receipt

def transport(payload, host, ssh='ssh'):
    # Source and JSON use separate channels; user prose never becomes shell code.
    source = pathlib.Path(__file__).read_text().rsplit("\nif __name__ == '__main__':", 1)[0]
    source = "__file__ = '/tmp/ab-mini-run.py'\n" + source
    source += '\np = json.load(sys.stdin)\nprint(json.dumps(remote(p)))\n'
    encoded = base64.b64encode(source.encode()).decode()
    remote_cmd = "python3 -c \"import base64; exec(base64.b64decode('" + encoded + "'))\""
    try:
        result = subprocess.run([ssh, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', '-o', 'RequestTTY=no', '-o', 'RemoteCommand=none', host, remote_cmd], input=json.dumps(payload), text=True, capture_output=True, timeout=3650 if payload['kind'] == 'ui-soul' else 650)
        if result.returncode:
            return {'identity': payload['identity'], 'revision': payload['revision'], 'state': 'blocked', 'reason': 'SSH failed; remote outcome unknown. Retry the same identity to recover its receipt.', 'transportExit': result.returncode}
        value = json.loads(result.stdout.strip().splitlines()[-1])
        if value.get('identity') != payload['identity'] or value.get('revision') != payload['revision']:
            raise ValueError('remote receipt identity/revision mismatch')
        return value
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        return {'identity': payload['identity'], 'revision': payload['revision'], 'state': 'blocked', 'reason': 'Transport/receipt unavailable; recover same identity before retry: ' + type(exc).__name__}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', choices=['ui-soul', 'qa'])
    parser.add_argument('--ship-receipt')
    parser.add_argument('--mirror')
    parser.add_argument('--companion-receipt', help='Hash-verified preparation receipt for this revision and its Estate companion')
    parser.add_argument('--host', default='mac-mini-herdr')
    parser.add_argument('--receipt')
    parser.add_argument('--revision', help='Pin UI launch/recovery to this full local commit')
    parser.add_argument('worker', nargs='*')
    ns = parser.parse_args()
    if ns.host.startswith('-') or not re.fullmatch(r'[a-zA-Z0-9_.@-]+', ns.host): parser.error('invalid SSH host')
    if ns.kind == 'ui-soul':
        if len(ns.worker) != 8: parser.error('ui-soul needs NAME TASK COMP SLUG PORT TITLE WORDS ASK')
        name, task, comp, slug, port, title, words, ask = ns.worker
        if not re.fullmatch(r't-\d+', task) or not re.fullmatch(r'[a-zA-Z0-9-]+', slug): parser.error('invalid task or slug')
        revision = ns.revision or command(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'])
        if not re.fullmatch(r'[0-9a-f]{40}', revision): parser.error('full 40-character revision required')
        policy = json.loads((pathlib.Path.home() / 'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/routing.json').read_text())
        model = policy['roles_model']
        identity = ('ui-soul-' + task + '-' + slug.lower())[:100]
        brief = (ROOT / 'tools/ui-soul/brief.md').read_text()
        for key, value in dict(NAME=name,TASK=task,COMP=comp,SLUG=slug,PORT=port,TITLE=title,WORDS=words,ASK=ask,BRANCH='codex/' + identity).items(): brief = brief.replace('{{' + key + '}}', value)
        payload = dict(kind=ns.kind, identity=identity, revision=revision, model=model, name=name, task=task, brief=brief)
    else:
        if not ns.ship_receipt or not ns.mirror: parser.error('qa needs --ship-receipt and --mirror')
        ship = json.loads(pathlib.Path(ns.ship_receipt).read_text())
        revision = ship.get('merged_sha') or ship.get('revision')
        if ship.get('result') not in ['shipped', 'installed'] or not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}', revision): parser.error('only a successful ship with full revision can trigger QA')
        payload = dict(kind='qa', identity='qa-' + revision, revision=revision, mirror=ns.mirror)
        if ns.companion_receipt:
            preparation = json.loads(pathlib.Path(ns.companion_receipt).read_text())
            if preparation.get('revision') != revision or preparation.get('preserved') is not True or not preparation.get('companion'):
                parser.error('companion preparation receipt must match revision and prove preservation')
            payload['companion'] = preparation['companion']
    value = transport(payload, ns.host)
    dest = pathlib.Path(ns.receipt) if ns.receipt else ROOT / '.agents/runs/mini-delivery' / (payload['identity'] + '.json')
    save(dest, value)
    print(json.dumps(value))
    return 0 if value['state'] == 'passed' else 1

if __name__ == '__main__':
    sys.exit(main())
