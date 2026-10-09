#!/usr/bin/env node
// Owner-only post-run evidence CLI. It consumes the same local store the node comparison route reads.
import {createWriterMeasurementOwner} from '../../node/src/writer-measurements.ts';
const [action,id,...rest]=process.argv.slice(2),owner=createWriterMeasurementOwner();
const fail=message=>{console.error(message);process.exit(2);};
if(!id||!/^[A-Za-z0-9_-]{1,128}$/.test(id))fail('Usage: writer-measurement <bind|check|shot|finalize> RUN_ID ...');
try{
 if(action==='bind'){console.log(await owner.bindEvidenceRevision(id));}
 else if(action==='check'){
  if(rest[0]!=='--'||rest.length<2)fail('Usage: writer-measurement check RUN_ID -- EXECUTABLE [ARG ...]');
  console.log(JSON.stringify({exitCode:await owner.executeCheck(id,rest[1],rest.slice(2))}));
 }
 else if(action==='shot'){
  const [file,w,h,...extra]=rest.map((v,i)=>i===0?v:Number(v));
  if(extra.length||typeof file!=='string'||!Number.isSafeInteger(w)||!Number.isSafeInteger(h))fail('Usage: writer-measurement shot RUN_ID PNG_PATH WIDTH HEIGHT');
  await owner.screenshot(id,file,{width:w,height:h});console.log('screenshot evidence recorded');
 }
 else if(action==='finalize')console.log(JSON.stringify(await owner.finalize(id)));
 else fail('Usage: writer-measurement <bind|check|shot|finalize> RUN_ID ...');
}catch(e){console.error(e instanceof Error?e.message:'Writer measurement operation failed');process.exitCode=1;}
