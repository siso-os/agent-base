#!/usr/bin/env python3
import base64, hashlib, importlib.util, json, os, pathlib, subprocess, tempfile, unittest
from unittest.mock import patch, MagicMock
MODULE = pathlib.Path(__file__).resolve().parents[1] / 'ab-mini-run.py'
spec=importlib.util.spec_from_file_location('mini',MODULE); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SHA='a'*40
class MiniContract(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='.siso-ephemeral-mini-contract.');self.home=pathlib.Path(self.tmp.name)
  self.homepatch=patch.object(m.pathlib.Path,'home',return_value=self.home);self.homepatch.start()
  self.resource=patch.object(m,'resource_check',return_value={'freeDiskBytes':20*1024**3}).start()
  self.cmd=patch.object(m,'command',return_value=SHA).start()
  self.which=patch.object(m.shutil,'which',side_effect=lambda x:'/stub/'+x);self.which.start()
  self.payload={'kind':'ui-soul','identity':'ui-soul-t-0386-test','revision':SHA,'model':'gpt-6-astra','name':'TEST','task':'t-0386','brief':'Synthetic brief "$(touch never)"'}
  p=self.home/'SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/routing.json';p.parent.mkdir(parents=True);p.write_text(json.dumps({'roles_model':'gpt-6-astra'}))
 def tearDown(self):
  patch.stopall();self.tmp.cleanup()
 def launch(self,code=0):
  def cmd(args,**kw):
   if 'worktree' in args:pathlib.Path(args[-2]).mkdir(parents=True)
   return SHA
  self.cmd.side_effect=cmd
  child=MagicMock(pid=12345);child.wait.return_value=code
  with patch.object(m.subprocess,'Popen',return_value=child) as run:
   first=m.remote(self.payload);second=m.remote(self.payload)
   self.assertEqual(run.call_count,1)
   args=run.call_args.args[0];self.assertIn('gpt-6-astra',args);self.assertIn('high',args);self.assertIn('--workspace',args)
   self.assertTrue(second['reused']);self.assertEqual(first['state'],second['state'])
   return first
 def test_launch_is_exactly_once_with_stable_receipt(self):self.assertEqual(self.launch()['state'],'passed')
 def test_failure_never_relaunches(self):self.assertEqual(self.launch(2)['state'],'failed')
 def test_existing_workspace_not_adopted(self):
  (self.home/m.WORKTREES/self.payload['identity']).mkdir(parents=True)
  self.assertIn('workspace already exists',m.remote(self.payload)['reason'])
 def test_mismatched_routing_blocked(self):
  self.payload['model']='old-model';self.assertEqual(m.remote(self.payload)['state'],'blocked')
 def test_identity_conflict_preserves_receipt(self):
  self.launch();self.payload['brief']='different';self.assertIn('identity conflict',m.remote(self.payload)['reason'])
 def test_interrupted_receipt_recovered_without_launch(self):
  state=self.home/'.local/state/agent-base/mini-delivery';state.mkdir(parents=True)
  p=state/(self.payload['identity']+'.json');m.save(p,{'identity':self.payload['identity'],'fingerprint':m.digest(self.payload),'started':True,'state':'running'})
  with patch.object(m.subprocess,'Popen') as launch:
   self.assertEqual(m.remote(self.payload)['state'],'unknown');launch.assert_not_called()
 def test_resources_block_before_worktree(self):
  self.resource.side_effect=RuntimeError('disk low');self.assertEqual(m.remote(self.payload)['state'],'blocked');self.cmd.assert_not_called()
 def test_transport_failure_never_clean(self):
  with patch.object(m.subprocess,'run',return_value=MagicMock(returncode=255)):
   self.assertEqual(m.transport(self.payload,'mac-mini-herdr')['state'],'blocked')
 def test_transport_json_not_shell_prose(self):
  result=MagicMock(returncode=0,stdout=json.dumps({'identity':self.payload['identity'],'revision':SHA,'state':'passed'}))
  with patch.object(m.subprocess,'run',return_value=result) as run:
   self.assertEqual(m.transport(self.payload,'mac-mini-herdr')['state'],'passed')
   self.assertNotIn('touch never',run.call_args.args[0][-1]);self.assertEqual(json.loads(run.call_args.kwargs['input']),self.payload)
   src=base64.b64decode(run.call_args.args[0][-1].split("b64decode('")[1].split("')")[0]);compile(src,'remote','exec')
 def test_receipt_identity_mismatch_blocked(self):
  with patch.object(m.subprocess,'run',return_value=MagicMock(returncode=0,stdout='{"identity":"other"}')):
   self.assertEqual(m.transport(self.payload,'mac-mini-herdr')['state'],'blocked')
 def test_qa_refuses_live_checkout(self):
  p={'kind':'qa','identity':'qa-'+SHA,'revision':SHA,'mirror':str(self.home/m.REPO)}
  self.assertEqual(m.remote(p)['state'],'blocked');self.assertIn('dedicated qa-',m.remote(p)['reason'])
 def test_qa_revision_mismatch(self):
  p={'kind':'qa','identity':'qa-'+SHA,'revision':SHA,'mirror':str(self.home/m.WORKTREES/'qa-walker')}
  self.cmd.side_effect=[SHA,'b'*40]
  self.assertIn('HEAD does not match',m.remote(p)['reason'])
 def test_qa_ship_receipt_gate(self):
  p=self.home/'ship.json';p.write_text(json.dumps({'result':'failed','merged_sha':SHA}))
  r=subprocess.run(['python3',str(MODULE),'qa','--ship-receipt',str(p),'--mirror','unused'],capture_output=True,text=True)
  self.assertEqual(r.returncode,2);self.assertIn('successful ship',r.stderr)
 def test_qa_companion_cli_rejects_wrong_revision_before_transport(self):
  ship=self.home/'ship.json';ship.write_text(json.dumps({'result':'installed','revision':SHA}))
  prep=self.home/'prep.json';prep.write_text(json.dumps({'revision':'b'*40,'preserved':True,'companion':{'files':{}}}))
  r=subprocess.run(['python3',str(MODULE),'qa','--ship-receipt',str(ship),'--mirror','unused','--companion-receipt',str(prep)],capture_output=True,text=True)
  self.assertEqual(r.returncode,2);self.assertIn('companion preparation receipt',r.stderr)
 def test_qa_success_is_revision_bound_and_reused(self):
  mirror=self.home/m.WORKTREES/'qa-walker';(mirror/'apps/web/dist').mkdir(parents=True);(mirror/'tools').mkdir()
  (mirror/'apps/web/dist/DEPLOYED_SHA').write_text(SHA);(mirror/'tools/ab-qa-walk.mjs').write_text('// stub')
  payload={'kind':'qa','identity':'qa-'+SHA,'revision':SHA,'mirror':str(mirror)}
  self.cmd.side_effect=lambda args,**kw: '' if 'status' in args else SHA
  def finish(**kw):
   out=self.home/'.local/state/agent-base/mini-delivery'/payload['identity']
   (out/'walk.json').write_text(json.dumps({'state':'passed','routes':[{'id':'stub','state':'passed'}],'bugs':[]}));return 0
  child=MagicMock(pid=123);child.wait.side_effect=finish
  with patch.object(m.subprocess,'Popen',return_value=child) as run:
   self.assertEqual(m.remote(payload)['state'],'passed');self.assertTrue(m.remote(payload)['reused']);self.assertEqual(run.call_count,1)
 def test_unknown_prior_job_prevents_different_admission(self):
  state=self.home/'.local/state/agent-base/mini-delivery';state.mkdir(parents=True)
  m.save(state/'other.json',{'started':True,'state':'unknown'})
  self.assertIn('Unresolved prior',m.remote(self.payload)['reason']);self.resource.assert_not_called()
 def test_qa_companion_hash_gate_and_exact_once_receipt(self):
  mirror=self.home/m.WORKTREES/'qa-companion';(mirror/'apps/web/dist').mkdir(parents=True);(mirror/'tools').mkdir();(mirror/'.qa-estate').mkdir()
  (mirror/'apps/web/dist/DEPLOYED_SHA').write_text(SHA);(mirror/'tools/ab-qa-walk.mjs').write_text('// stub')
  (mirror/'.qa-estate/world.html').write_text('synthetic artifact')
  (mirror/'.qa-estate/manifest.json').write_text(json.dumps({'sourceRevision':'b'*40}))
  hashes={n:hashlib.sha256((mirror/'.qa-estate'/n).read_bytes()).hexdigest() for n in ['world.html','manifest.json']}
  payload={'kind':'qa','identity':'qa-'+SHA,'revision':SHA,'mirror':str(mirror),'companion':{'sourceRevision':'b'*40,'files':hashes}}
  self.cmd.side_effect=lambda args,**kw: '' if 'status' in args else SHA
  def finish(**kw):
   out=self.home/'.local/state/agent-base/mini-delivery'/payload['identity']
   (out/'walk.json').write_text(json.dumps({'state':'passed','routes':[],'bugs':[],'companion':{'rendered':True}}));return 0
  child=MagicMock(pid=123);child.wait.side_effect=finish
  with patch.object(m.subprocess,'Popen',return_value=child) as run:
   result=m.remote(payload);self.assertEqual(result['state'],'passed');self.assertEqual(result['companion'],payload['companion'])
   self.assertIn('--companion-manifest',run.call_args.args[0]);self.assertTrue(m.remote(payload)['reused']);self.assertEqual(run.call_count,1)
   payload['companion']['files']['world.html']='0'*64
   self.assertIn('identity conflict',m.remote(payload)['reason']);self.assertEqual(run.call_count,1)
 def test_qa_companion_tamper_blocks_before_process(self):
  mirror=self.home/m.WORKTREES/'qa-companion';(mirror/'apps/web/dist').mkdir(parents=True);(mirror/'tools').mkdir();(mirror/'.qa-estate').mkdir()
  (mirror/'apps/web/dist/DEPLOYED_SHA').write_text(SHA);(mirror/'tools/ab-qa-walk.mjs').write_text('// stub')
  (mirror/'.qa-estate/world.html').write_text('tampered');(mirror/'.qa-estate/manifest.json').write_text('{}')
  payload={'kind':'qa','identity':'qa-'+SHA,'revision':SHA,'mirror':str(mirror),'companion':{'sourceRevision':'b'*40,'files':{'world.html':'0'*64,'manifest.json':'0'*64}}}
  self.cmd.side_effect=lambda args,**kw: '' if 'status' in args else SHA
  with patch.object(m.subprocess,'Popen') as run:
   self.assertIn('companion hash mismatch',m.remote(payload)['reason']);run.assert_not_called()
if __name__=='__main__':unittest.main()
