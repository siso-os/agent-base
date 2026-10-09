#!/usr/bin/env python3
"""Bounded hook contract tests; no SSH, Mini processes or deployment commands."""
import argparse, base64, importlib.util, io, json, pathlib, tarfile, tempfile, unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('hook', ROOT / 'tools/ab-after-install-qa.py')
hook = importlib.util.module_from_spec(spec); spec.loader.exec_module(hook)
REV = 'a' * 40

class HookTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.dist = self.root / 'dist'; self.dist.mkdir(); (self.dist / 'index.html').write_text('accepted')
        self.hashes = hook.inventory(self.dist)
        self.acceptance = self.root / 'acceptance.json'
        self.acceptance.write_text(json.dumps({'acceptedCommit': REV, 'distHashes': self.hashes}))
        self.install = self.root / 'install.json'
        self.install.write_text(json.dumps({'result': 'installed', 'revision': REV, 'after': {'sha': REV}, 'acceptance': str(self.acceptance), 'newDistHashes': self.hashes}))
        self.ns = argparse.Namespace(revision=REV, install_receipt=str(self.install), acceptance=None, source=str(self.root), dist=str(self.dist), installed_dist=None, readback_url=None, state=str(self.root / 'state'), host='mini')
        self.git = patch.object(hook, 'git', return_value='b' * 40); self.git.start(); self.addCleanup(self.git.stop)
        self.prepare = Mock(return_value={'mirror': '/owned/qa-' + REV})
        self.transport = Mock(return_value={'revision': REV, 'identity': 'qa-' + REV, 'state': 'passed', 'started': True})

    def invoke(self): return hook.trigger(self.ns, self.prepare, self.transport)

    def test_success_and_duplicate_exactly_once(self):
        result = self.invoke(); again = self.invoke()
        self.assertEqual(result['state'], 'passed'); self.assertTrue(again['reused'])
        self.prepare.assert_called_once(); self.transport.assert_called_once()
        self.assertEqual(result['evidence']['distHashes'], self.hashes)
        self.assertEqual(json.loads(self.install.read_text())['result'], 'installed')

    def test_failed_qa_keeps_healthy_install_and_never_restarts(self):
        self.transport.return_value['state'] = 'failed'
        before = self.install.read_bytes()
        self.assertEqual(self.invoke()['state'], 'failed')
        self.assertEqual(self.invoke()['state'], 'failed')
        self.transport.assert_called_once(); self.assertEqual(self.install.read_bytes(), before)

    def test_transport_error_has_durable_followup(self):
        self.prepare.side_effect = RuntimeError('Mini unavailable')
        result = self.invoke(); self.assertEqual(result['state'], 'blocked')
        self.assertEqual(json.loads(pathlib.Path(result['receiptPath']).read_text())['installResult'], 'installed')
        self.invoke(); self.prepare.assert_called_once(); self.transport.assert_not_called()

    def test_interruption_never_relaunches(self):
        result = self.invoke(); path = pathlib.Path(result['receiptPath'])
        result['state'] = 'running'; hook.mini.save(path, result)
        self.assertEqual(self.invoke()['state'], 'unknown'); self.transport.assert_called_once()

    def test_ship_only_defers_then_verified_install_runs(self):
        self.ns.install_receipt = None
        self.assertEqual(self.invoke()['state'], 'deferred'); self.prepare.assert_not_called()
        self.ns.install_receipt = str(self.install)
        self.assertEqual(self.invoke()['state'], 'passed'); self.transport.assert_called_once()

    def test_readback_mismatch_blocks_before_preparation(self):
        value = json.loads(self.install.read_text()); value['after']['sha'] = 'c' * 40
        self.install.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'readback'): self.invoke()
        self.prepare.assert_not_called()

    def test_artifact_tampering_blocks_before_preparation(self):
        (self.dist / 'index.html').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'artifact hash mismatch'): self.invoke()
        self.prepare.assert_not_called()

    def test_source_tree_mismatch_blocks_before_preparation(self):
        hook.git.side_effect = ['b' * 40, 'c' * 40]
        with self.assertRaisesRegex(ValueError, 'source tree'): self.invoke()
        self.prepare.assert_not_called()

    def test_receipt_conflict_preserves_prior(self):
        result = self.invoke(); before = pathlib.Path(result['receiptPath']).read_bytes()
        value = json.loads(self.install.read_text()); value['extra'] = 'changed'; self.install.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'evidence conflict'): self.invoke()
        self.assertEqual(pathlib.Path(result['receiptPath']).read_bytes(), before)

    def test_existing_remote_attempt_is_reused_without_transport(self):
        self.prepare.return_value = {'existing': self.transport.return_value}
        self.assertEqual(self.invoke()['state'], 'passed'); self.transport.assert_not_called()

    def test_prior_remote_attempt_requires_matching_artifact_provenance(self):
        _, proof = hook.validate(self.ns)
        with patch.object(hook, 'ssh_call', return_value={'existing': self.transport.return_value, 'preparation': {}}):
            with self.assertRaisesRegex(ValueError, 'provenance unavailable'):
                hook.prepare(self.ns, proof, self.root)

    def companion_fixture(self):
        folder=self.root/'companion';folder.mkdir();(folder/'world.html').write_text('synthetic artifact')
        pins=json.dumps({'revision':'c'*40,'files':{'src/data.ts':'d'*64}}).encode();producer=b'approved fixture producer'
        manifest={'schema':1,'kind':'estate-synthetic-companion','inputMode':'synthetic-only','privateInputsRead':False,'sourceRevision':'c'*40,'sourceFiles':{'src/data.ts':'d'*64},'pinsSha256':hook.sha(pins),'producerSha256':hook.sha(producer),'artifact':{'file':'world.html','sha256':hook.sha((folder/'world.html').read_bytes()),'bytes':len((folder/'world.html').read_bytes())}}
        (folder/'manifest.json').write_text(json.dumps(manifest));self.ns.companion_manifest=str(folder/'manifest.json')
        mocked=patch.object(hook,'run',side_effect=lambda args,**kw: pins if args[-1].endswith('ab-estate-source.json') else producer)
        mocked.start();self.addCleanup(mocked.stop)
        proof={'sourceRevision':'c'*40,'files':{n:hook.sha((folder/n).read_bytes()) for n in ['manifest.json','world.html']}}
        return folder,proof

    def test_companion_needs_authoritative_acceptance_hashes(self):
        folder,proof=self.companion_fixture()
        with self.assertRaisesRegex(ValueError,'not accepted'):self.invoke()
        self.prepare.assert_not_called()
        acceptance=json.loads(self.acceptance.read_text());acceptance['estateCompanion']=proof;self.acceptance.write_text(json.dumps(acceptance))
        result=self.invoke();self.assertEqual(result['state'],'passed')
        self.assertEqual(self.transport.call_args.args[0]['companion'],proof)
        self.assertEqual(result['evidence']['companion'],proof)
        self.assertTrue(self.invoke()['reused']);self.transport.assert_called_once()

    def test_companion_tamper_or_missing_argument_cannot_dispatch(self):
        folder,proof=self.companion_fixture()
        acceptance=json.loads(self.acceptance.read_text());acceptance['estateCompanion']=proof;self.acceptance.write_text(json.dumps(acceptance))
        (folder/'world.html').write_text('changed')
        with self.assertRaisesRegex(ValueError,'artifact hash'):self.invoke()
        self.ns.companion_manifest=None
        with self.assertRaisesRegex(ValueError,'--companion-manifest'):self.invoke()
        self.transport.assert_not_called()

    def test_cli_failure_returns_success_with_separate_receipt(self):
        with patch('sys.argv', ['hook', '--revision', REV, '--install-receipt', '/missing', '--state', self.ns.state]):
            self.assertEqual(hook.main(), 0)
        errors = list(pathlib.Path(self.ns.state).glob('follow-up-error-*.json'))
        self.assertEqual(len(errors), 1); self.assertEqual(json.loads(errors[0].read_text())['state'], 'blocked')

    def test_remote_program_is_self_contained_and_legacy_hooks_are_success_only(self):
        compile(hook.remote_source(), '<remote-preparation>', 'exec')
        live = (ROOT / 'tools/ab-live').read_text()
        self.assertIn('trap cleanup EXIT; log "$SHA" "$KIND" live "" "$DESKTOP_PENDING"; mark "$SHA"; mini_followup;', live)
        ship = (ROOT / 'tools/ab-ship').read_text()
        self.assertIn('if [[ "$outcome" == shipped ]]; then', ship)
        self.assertIn('installation remains successful', live)

    def remote_fixture(self, extra=False, companion=False):
        namespace = {}; exec(hook.remote_source(), namespace)
        index = self.root / 'canonical-index'; index.write_bytes(b'owned-index-unchanged')
        archive = io.BytesIO()
        companion_files={'manifest.json':b'{"sourceRevision":"synthetic"}','world.html':b'<html>Synthetic</html>'}
        with tarfile.open(fileobj=archive, mode='w:gz') as tar:
            for name, data in [('dist/index.html', b'accepted')] + ([('../escape', b'bad')] if extra else []) + ([('companion/'+n,data) for n,data in companion_files.items()] if companion else []):
                member = tarfile.TarInfo(name); member.size = len(data); tar.addfile(member, io.BytesIO(data))
        payload = {'revision': REV, 'sourceTree': 'b' * 40, 'distHashes': self.hashes, 'bundleHash': None, 'archive': base64.b64encode(archive.getvalue()).decode()}
        if companion:payload['companion']={'sourceRevision':'synthetic','files':{n:hook.sha(data) for n,data in companion_files.items()}}
        def command(args, **kw):
            if args[0] == 'vm_stat': return b'Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 1048576.\nPages inactive: 0.\nPages speculative: 0.\n'
            if args[-1] == 'index': return str(index).encode()
            if args[-1] == 'HEAD': return ('c' * 40).encode()
            if args[-1] == REV + '^{tree}': return ('b' * 40).encode()
            if 'worktree' in args and 'add' in args:
                pathlib.Path(args[-2]).mkdir(parents=True); return b''
            if 'status' in args or 'ls-tree' in args: return b''
            raise AssertionError(args)
        return namespace['remote_prepare'], payload, command, index

    def test_remote_mirror_hashes_and_canonical_index_preserved(self):
        remote, payload, command, index = self.remote_fixture()
        with patch.object(pathlib.Path, 'home', return_value=self.root), patch('subprocess.check_output', side_effect=command), patch('shutil.disk_usage', return_value=argparse.Namespace(free=20 * 1024**3)):
            result = remote(payload)
        mirror = pathlib.Path(result['mirror'])
        self.assertEqual((mirror / 'apps/web/dist/index.html').read_text(), 'accepted')
        self.assertEqual((mirror / 'apps/web/dist/DEPLOYED_SHA').read_text().strip(), REV)
        self.assertEqual(index.read_bytes(), b'owned-index-unchanged')
        self.assertTrue(json.loads(pathlib.Path(result['preparation']).read_text())['preserved'])

    def test_remote_unexpected_archive_member_refused_without_escape(self):
        remote, payload, command, index = self.remote_fixture(extra=True)
        with patch.object(pathlib.Path, 'home', return_value=self.root), patch('subprocess.check_output', side_effect=command), patch('shutil.disk_usage', return_value=argparse.Namespace(free=20 * 1024**3)):
            with self.assertRaisesRegex(ValueError, 'unexpected archive'): remote(payload)
        self.assertFalse((self.root / 'escape').exists())
        self.assertEqual(index.read_bytes(), b'owned-index-unchanged')

    def test_remote_companion_transfer_is_hash_checked_and_receipted(self):
        remote,payload,command,index=self.remote_fixture(companion=True)
        with patch.object(pathlib.Path,'home',return_value=self.root),patch('subprocess.check_output',side_effect=command),patch('shutil.disk_usage',return_value=argparse.Namespace(free=20*1024**3)):
            result=remote(payload)
        for name,expected in payload['companion']['files'].items():
            self.assertEqual(hook.sha((pathlib.Path(result['mirror'])/'.qa-estate'/name).read_bytes()),expected)
        receipt=json.loads(pathlib.Path(result['preparation']).read_text())
        self.assertEqual(receipt['companion'],payload['companion']);self.assertTrue(receipt['preserved'])

if __name__ == '__main__': unittest.main()
