// Standalone native helper acceptance. Test mode forbids OS microphone, focus, keyboard and clipboard I/O.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
const repo = path.resolve(import.meta.dirname, "../../..");
const scratch = mkdtempSync(path.join(tmpdir(), ".siso-ephemeral-native-dictation."));
const shots = path.join(repo, ".shots"); mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok) => { results.push({name, ok: Boolean(ok)}); writeFileSync(path.join(shots, "dictation-native-checks.json"), JSON.stringify(results)); console.log(JSON.stringify(results.at(-1))); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await wait(30); } return false; };
let owner = "siso-voice", registered = false, holdResponse = false, failResponse = false, rolling = false, partial = false, emptyTail = false;
let rollAnswers = [], statusDown = false, statusFailures = 0, disconnectTranscribe = false;
const takes = [], events = [], actions = [], delayed = [];
const fixture = path.join(scratch, "fake.wav"), audio = Buffer.from("RIFFfakeWAVEfake-audio"); writeFileSync(fixture, audio);
const server = createServer(async (req, res) => {
  if (req.url.split("?")[0] === "/api/dictation/status" && statusDown) { statusFailures++; return res.destroy(); }
  if (req.url.split("?")[0] === "/api/dictation/status") return res.writeHead(200, {"content-type":"application/json"}).end(JSON.stringify({owner}));
  const chunks=[]; for await (const c of req) chunks.push(c); const data=Buffer.concat(chunks);
  if (req.url === "/api/dictation/native") { registered=JSON.parse(data).registered; return res.writeHead(200).end('{}'); }
  if (req.url === "/api/dictation/events") { events.push(JSON.parse(data)); return res.writeHead(200).end('{}'); }
  if (req.url.startsWith('/api/dictation/transcribe')) {
    const u=new URL(req.url,'http://fixture'); takes.push({app:u.searchParams.get('app'),bundle:u.searchParams.get('bundleId'),quiet:u.searchParams.get('quiet'),id:u.searchParams.get('id'),audio:data.equals(audio)});
    if (disconnectTranscribe) return res.destroy();
    if (rolling) {
      const index = rollAnswers.length;
      let answered = false; const isPartial = partial;
      const answer = () => {
        if (answered || res.destroyed) return; answered = true;
        if (isPartial && index === 0) return res.writeHead(202, {'content-type':'application/json'}).end(JSON.stringify({queued:true}));
        if (isPartial && index === 1) return res.destroy();
        if (emptyTail && index > 0) return res.writeHead(422, {'content-type':'application/json'}).end(JSON.stringify({error:'Only silence was heard'}));
        res.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify({text:`Part ${index}.`}));
      };
      rollAnswers.push(answer); return;
    }
    const answer=()=>res.writeHead(failResponse?502:200,{'content-type':'application/json'}).end(JSON.stringify(failResponse?{error:'fixture rejection'}:{text:'A fake transcript.'}));
    if (holdResponse) delayed.push(answer); else answer(); return;
  }
  res.writeHead(404).end();
});
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
let helper, said='';
try {
  // swiftc is part of this test command, which callers run under heavy --.
  const compiled = spawnSync('swiftc',['-O','-framework','AppKit','-framework','AVFoundation','-framework','AudioToolbox',path.join(repo,'apps/desktop/native_dictation.swift'),'-o',path.join(scratch,'dictation')],{encoding:'utf8'});
  if(compiled.status!==0) throw new Error(`Swift fixture compile failed: ${compiled.stderr.slice(-1400)}`);
  check('native Swift source compiles for fixture harness',compiled.status===0);
  const env={...process.env,HOME:scratch,AB_DICTATION_TEST:'1',AB_DICTATION_ROLL_S:'2',AB_DICTATION_DIR:path.join(scratch,'dictation-state'),AB_PORT:String(server.address().port),AB_PARENT_PID:String(process.pid),AB_DICTATION_TEST_AUDIO:fixture,AB_DICTATION_TEST_APP:'Fake Editor',AB_DICTATION_TEST_BUNDLE:'com.fake.editor'};
  helper=spawn(path.join(scratch,'dictation'),[],{env,stdio:['pipe','pipe','pipe']}); let buffer='';helper.stderr.on('data',(chunk)=>{said+=chunk;});helper.stdout.on('data',(chunk)=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){try{actions.push(JSON.parse(line));}catch{}}});
  const command=(action,mode,extra={})=>helper.stdin.write(JSON.stringify({action,mode,...extra})+'\n');
  const focus=(app,bundle,typeable=true)=>command('focus',undefined,{app,bundle,typeable});
  const count=(name)=>actions.filter((a)=>a.action===name).length;
  await wait(400);command('down','hold');command('up','hold');await wait(150);
  check('unowned hotkeys cannot record',actions.length===0&&takes.length===0&&!registered);
  owner='agent-base';check('helper registers through node ownership handshake',await until(()=>registered));
  command('down','hold');command('down','hold');await wait(100);command('up','hold');
  check('hold release transcribes fixture, pastes and leaves it on the clipboard',await until(()=>count('paste')===1)&&count('clipboard')===1&&count('record-start')===1&&count('record-stop')===1&&takes[0].audio);
  check('the app in front at release reaches transcription',takes[0].app==='Fake Editor'&&takes[0].bundle==='com.fake.editor');
  check('fixture preserved after transcription',existsSync(fixture)&&readFileSync(fixture).equals(audio));
  command('toggle');await wait(120);command('down','hold');command('up','hold');await wait(120);
  check('Fn release does not stop a toggle recording',count('record-start')===2&&count('record-stop')===1);
  command('toggle');check('toggle stop completes a second take',await until(()=>count('paste')===2)&&count('record-stop')===2);
  // t-0506: he starts in one app and finishes in another; the words follow him and nothing is refused.
  focus('Fake Editor','com.fake.editor');command('toggle');await wait(80);focus('Other App','com.other.app');command('toggle');
  check('start in one app, stop in another: the words go to the second',await until(()=>count('paste')===3)&&takes.at(-1).app==='Other App'&&actions.filter((a)=>a.action==='paste').at(-1).bundle==='com.other.app');
  focus('Finder','com.apple.finder',false);command('toggle');await wait(60);command('toggle');
  check('nowhere to type: offered on the bar with Copy, on the clipboard, never an error',await until(()=>count('offer')===1)&&count('paste')===3&&count('clipboard')===4&&!events.slice(-3).some((e)=>e.phase==='error'));
  focus('Fake Editor','com.fake.editor');holdResponse=true;command('toggle');await wait(60);command('toggle');await until(()=>delayed.length===1);
  command('toggle');check('a new take starts while the last is still being written',await until(()=>count('record-start')===6));
  delayed.splice(0).forEach((answer)=>answer());check('the earlier take still pastes during the new recording',await until(()=>count('paste')===4));
  holdResponse=false;command('toggle');check('the new take lands too',await until(()=>count('paste')===5)&&takes.length===6);
  command('down','hold');await wait(100);const before=takes.length;owner='siso-voice';await until(()=>!registered);await wait(120);
  check('ownership release cancels recording without transcription',takes.length===before&&count('record-cancel')===1);
  owner='agent-base';await until(()=>registered);holdResponse=true;command('down','hold');command('up','hold');await until(()=>delayed.length===1);owner='siso-voice';await until(()=>!registered);delayed.splice(0).forEach((answer)=>answer());await wait(200);
  check('late transcription cannot paste after ownership release',count('paste')===5);
  owner='agent-base';await until(()=>registered);holdResponse=false;failResponse=true;command('down','hold');command('up','hold');
  check('provider failure produces error and never pastes',await until(()=>events.some((e)=>e.phase==='error'))&&count('paste')===5);
  check('native phases conform to node contract',events.every((e)=>['idle','starting','recording','transcribing','pasting','error'].includes(e.phase)));
  failResponse=false; rolling=true;
  const beforeRoll = {pastes:count('paste'), stops:count('record-stop'), rolls:count('record-roll'), phases:events.length};
  command('down','hold');
  check('roll every 2 seconds sends at least three parts while hold remains on',await until(()=>rollAnswers.length>=3,8000)&&count('record-roll')>=beforeRoll.rolls+3);
  rollAnswers[2](); await wait(150);
  check('early part responses remain quiet and every request opts into quiet mode',takes.slice(-3).every(t=>t.quiet==='1')&&count('paste')===beforeRoll.pastes);
  check('rolling never stops recording, pastes or changes the recording phase',count('record-stop')===beforeRoll.stops&&count('paste')===beforeRoll.pastes&&events.slice(beforeRoll.phases).every((e)=>e.phase==='recording'));
  focus('Stop App','com.stop.app');command('up','hold');
  check('stop submits the last part but waits for every answer before pasting',await until(()=>rollAnswers.length>=4)&&count('paste')===beforeRoll.pastes);
  // Resolve backwards and leave the first part outstanding to prove that arrival order is irrelevant.
  const expected = rollAnswers.map((_,i)=>`Part ${i}.`).join(' ');
  const firstAnswer = rollAnswers[0]; rollAnswers.slice(1).reverse().forEach((answer)=>answer());await wait(150);
  check('late first part keeps the joined paste waiting',count('paste')===beforeRoll.pastes);
  firstAnswer();
  check('one ordered paste follows stop and every response',await until(()=>count('paste')===beforeRoll.pastes+1)&&actions.filter((a)=>a.action==='paste').at(-1).text===expected&&actions.filter((a)=>a.action==='paste').at(-1).bundle==='com.stop.app');
  await wait(150);check('no extra paste follows a rolled take',count('paste')===beforeRoll.pastes+1);
  check('the former five-minute stop timer is absent',!readFileSync(path.join(repo,'apps/desktop/native_dictation.swift'),'utf8').includes('.now() + 300'));
  // Both retry paths leave the successful words pasteable exactly once.
  rollAnswers=[];partial=true;
  const {readdirSync, statSync}=await import('node:fs');
  const pendingDir=path.join(scratch,'dictation-state/pending');
  const queuedBefore=existsSync(pendingDir)?readdirSync(pendingDir).filter(f=>f.endsWith('.wav')).length:0;
  const beforePartial={pastes:count('paste'),phases:events.length};command('toggle');
  await until(()=>rollAnswers.length>=2,5500);command('toggle');await until(()=>rollAnswers.length>=3);
  const partialExpected = rollAnswers.map((_,i)=>i>=2?`Part ${i}.`:null).filter(Boolean).join(' ');
  rollAnswers.slice().reverse().forEach((answer)=>answer());
  check('queued and disconnected parts do not block one ordered partial paste',await until(()=>count('paste')===beforePartial.pastes+1)&&actions.filter((a)=>a.action==='paste').at(-1).text===partialExpected);
  check('missing parts announce background writing after the partial paste',await until(()=>events.slice(beforePartial.phases).some((e)=>e.error.includes('background'))));
  check('disconnected part is preserved for the existing retry queue',existsSync(pendingDir)&&readdirSync(pendingDir).filter(f=>f.endsWith('.wav')).length===queuedBefore+1&&readdirSync(pendingDir).some((f)=>f.endsWith('.wav')&&readFileSync(path.join(pendingDir,f)).equals(audio))&&readdirSync(pendingDir).some((f)=>f.endsWith('.json')));
  check('retry audio and metadata are private',readdirSync(pendingDir).every(f=>(statSync(path.join(pendingDir,f)).mode&0o777)===0o600));
  check('source fixture survives all rolls and retry preservation',readFileSync(fixture).equals(audio));
  rolling=false;partial=false;
  // A slow failed take must not hide the newer take's listening bar or lose its later notice.
  const beforeOverlap={pastes:count('paste'),phases:events.length};
  holdResponse=true;command('toggle');await wait(80);command('toggle');await until(()=>delayed.length===1);
  command('toggle');await wait(80);failResponse=true;delayed.splice(0).forEach(answer=>answer());
  await wait(150);
  check('an older failed take leaves the newer take recording',count('paste')===beforeOverlap.pastes&&events.at(-1).phase==='recording');
  failResponse=false;holdResponse=false;command('toggle');
  check('older background-retry notice survives until the newer take finishes',await until(()=>count('paste')===beforeOverlap.pastes+1)&&await until(()=>events.slice(beforeOverlap.phases).some(e=>e.error.includes('background'))));
  // The same joined take must keep the existing Copy fallback when no text field has focus.
  rolling=true;rollAnswers=[];focus('Finder','com.apple.finder',false);
  const beforeOffer={offers:count('offer'),pastes:count('paste')};command('toggle');
  await until(()=>rollAnswers.length>=1,3000);command('toggle');await until(()=>rollAnswers.length>=2);
  rollAnswers.slice().reverse().forEach(answer=>answer());
  check('rolled take offers Copy once when nowhere takes typing',await until(()=>count('offer')===beforeOffer.offers+1)&&count('paste')===beforeOffer.pastes);
  rollAnswers=[];emptyTail=true;focus('Fake Editor','com.fake.editor');
  const beforeSilent={pastes:count('paste'),phases:events.length};command('toggle');
  await until(()=>rollAnswers.length>=1,3000);command('toggle');await until(()=>rollAnswers.length>=2);
  rollAnswers.slice().reverse().forEach(answer=>answer());
  check('a silent final part still pastes prior words once without an error',await until(()=>count('paste')===beforeSilent.pastes+1)&&actions.filter(a=>a.action==='paste').at(-1).text==='Part 0.'&&!events.slice(beforeSilent.phases).some(e=>e.phase==='error'));
  rolling=false;emptyTail=false;
  const beforeOutage={stops:count('record-stop'),rolls:count('record-roll'),pastes:count('paste')};
  command('toggle'); statusDown=true;
  check('three missed ownership polls do not cancel an active recording',await until(()=>statusFailures>=3,6000)&&count('record-stop')===beforeOutage.stops);
  check('recording keeps rolling through a node status outage',await until(()=>count('record-roll')>=beforeOutage.rolls+2,5500)&&count('paste')===beforeOutage.pastes);
  disconnectTranscribe=true;command('toggle');
  check('stop during node outage still pastes answered parts once',await until(()=>count('paste')===beforeOutage.pastes+1));
  await wait(1500);
  check('node outage after stop preserves the background-retry notice',events.at(-1).phase==='error'&&events.at(-1).error.includes('background')&&registered);
  statusDown=false;disconnectTranscribe=false;await wait(1200);
  const beforeMic={stops:count('record-stop'),pastes:count('paste'),offers:count('offer'),phases:events.length};
  command('roll-fail');command('toggle');
  check('rotation device failure offers recovered words without an unsolicited paste',await until(()=>count('record-stop')===beforeMic.stops+1,4000)&&await until(()=>count('offer')===beforeMic.offers+1)&&count('paste')===beforeMic.pastes);
  check('device failure is explained on the bar instead of ending silently',await until(()=>events.slice(beforeMic.phases).some((e)=>e.phase==='error'&&e.error.includes('microphone stopped'))));
  // 9 Oct (VOICE): every part carries the take's own id, the helper's queued copy keeps it, and the log says what happened.
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  check('every part is sent with its own take id',takes.length>0&&takes.every((t)=>uuid.test(t.id||''))&&new Set(takes.map((t)=>t.id)).size===takes.length);
  const queuedDir=path.join(scratch,'dictation-state/pending');const queuedIds=existsSync(queuedDir)?readdirSync(queuedDir).filter((f)=>f.endsWith('.json')).map((f)=>JSON.parse(readFileSync(path.join(queuedDir,f),'utf8')).id):[];
  check('a part the node never answered is queued under the id it was sent with',queuedIds.length>0&&queuedIds.every((id)=>takes.some((t)=>t.id===id)));
  check('the helper logs presses, parts and outcomes, never the words',/start hold/.test(said)&&/part 0 → 200/.test(said)&&/take done/.test(said)&&!said.includes('A fake transcript'));
  const pasteOnly=spawnSync(path.join(scratch,'dictation'),['--paste-only'],{env,input:JSON.stringify({text:'fake repaste',bundleId:'com.fake.editor'}),encoding:'utf8'});
  check('re-paste uses shared native fake adapter and reports success',pasteOnly.status===0&&pasteOnly.stdout.includes('"paste"')&&pasteOnly.stdout.includes('"clipboard"'));
  const invalid=spawnSync(path.join(scratch,'dictation'),['--paste-only'],{env,input:JSON.stringify({text:'fake repaste',bundleId:''}),encoding:'utf8'});
  check('missing re-paste target fails instead of typing into current app',invalid.status===2&&!invalid.stdout.includes('"paste"'));
} catch(e) { check(e.message,false); }
finally { helper?.kill('SIGTERM'); delayed.splice(0).forEach((answer)=>answer()); rollAnswers.forEach((answer)=>answer()); await new Promise((r)=>server.close(r)); rmSync(scratch,{recursive:true,force:true}); }
const passed=results.filter((r)=>r.ok).length;console.log(JSON.stringify({passed,of:results.length}));if(passed!==results.length)process.exitCode=1;
