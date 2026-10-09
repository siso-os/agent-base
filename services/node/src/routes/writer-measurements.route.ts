import type {Route} from './registry.ts';
import {compareWriterJobs} from '../writer-gates.ts';
import {createWriterMeasurementOwner} from '../writer-measurements.ts';

const owner=createWriterMeasurementOwner();
export const route:Route={method:'GET',path:/^\/api\/writer-jobs\/compare$/,async handle(_req,res,_match,url){
 const q=url?.searchParams??new URL(_req.url??'','http://localhost').searchParams;
 const saved=q.get('saved'),fresh=q.get('fresh');
 if(q.size!==2||!saved||!fresh||saved.length>128||fresh.length>128){res.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Provide only saved and fresh run IDs'}));return;}
 try{const result=await compareWriterJobs(saved,fresh,id=>owner.resolve(id));res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));}
 catch(e){res.writeHead(422,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e instanceof Error?e.message:'Comparison evidence unavailable'}));}
}};
