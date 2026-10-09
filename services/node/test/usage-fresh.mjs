import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSeatLimits } from '../../host/src/limits.ts';
import { seatHud } from '../src/seat-hud.ts';

const dir = mkdtempSync(path.join(tmpdir(), '.siso-ephemeral-usage-fresh.'));
try {
  const profile = path.join(dir, 'claude'), ctx = path.join(dir, 'ctx');
  mkdirSync(path.join(profile, 'projects'), {recursive:true}); mkdirSync(ctx);
  const file = path.join(profile, 'projects', 'seat.jsonl');
  writeFileSync(file, JSON.stringify({type:'assistant', message:{id:'m1',model:'claude-opus-5-5',usage:{input_tokens:12000,output_tokens:100}}})+'\n');
  const old = Date.now()-3600000;
  writeFileSync(path.join(ctx,'peer.json'), JSON.stringify({profile,context_window_size:1000000,model:{id:'claude-opus-5-5'},at:old,rate_limits:{five_hour:{used_percentage:22},seven_day:{used_percentage:17}}}));
  let opts;
  const sdk = {usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async o => {
    opts=o;return {rate_limits_available:true,rate_limits:{five_hour:{utilization:0,resets_at:'2026-10-04T10:00:00Z'},seven_day:{utilization:88,resets_at:'2026-10-08T10:00:00Z'}}};
  }};
  const fresh = await readSeatLimits(sdk);
  assert.deepEqual(opts,{skipBehaviors:true}); assert.equal(fresh.five_hour.used_percentage,0);
  const borrowed = seatHud(file,ctx);
  assert.equal(borrowed.at,old); // NOT this newly-written session's mtime
  const own = seatHud(file,ctx,undefined,fresh);
  assert.equal(own.rate_limits.five_hour.used_percentage,0);
  assert.equal(own.rate_limits.seven_day.used_percentage,88);
  assert.equal(own.at,fresh.at); assert.equal(own.used_percentage,borrowed.used_percentage);
  const other = path.join(dir,'other','projects','seat.jsonl');mkdirSync(path.dirname(other),{recursive:true});
  writeFileSync(other, JSON.stringify({type:'assistant',message:{model:'claude-opus-5-5',usage:{input_tokens:100}}})+'\n');
  assert.equal(seatHud(other,ctx).rate_limits,undefined);
  assert.equal(await readSeatLimits({}),null);
  assert.equal(await readSeatLimits({usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET:async()=>{throw Error('private');}}),null);
  for (const utilization of [null,NaN,Infinity,-1,101,'7']) {
    assert.equal(await readSeatLimits({usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET:async()=>({rate_limits_available:true,rate_limits:{five_hour:{utilization},seven_day:{utilization:88}}})}),null);
  }
  console.log('PASS: SDK limits replace stale borrowed limits; original read time, zero %, context unchanged, login isolation, unavailable/invalid/failure handled');
} finally { rmSync(dir,{recursive:true,force:true}); }
