import { listServiceHosts } from "../service-hosts.ts";
import { ChangesError } from "../changes.ts";
import type { ReviewScope } from "../../../../apps/web/src/lib/changes.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function changesRoutes(runtime: Pick<HttpRuntime, "HOSTS_DIR" | "changes" | "json" | "listAgents" | "readBody">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { HOSTS_DIR, changes, json, listAgents, readBody } = runtime;
      // Host-only baseline/completion intake. Credentials are headers and are never returned or logged.
      if (url.pathname === '/api/changes/turns' && req.method === 'POST') {
        try {
          const b=JSON.parse(await readBody(req));
          const hosts=await listServiceHosts({dir:HOSTS_DIR});
          const candidates=hosts.filter(h=>h.session===b.sessionId && req.headers.authorization===`Bearer ${h.token}` && h.state==='live');
          if(candidates.length!==1)throw new ChangesError('host-unavailable','Unknown boundary owner',403);
          const host=candidates[0],rows=await listAgents(0),matches=rows.filter(r=>r.session===host.session && (host.pane?r.pane===host.pane:r.id===`service-${host.name}`));
          if(matches.length!==1)throw new ChangesError('mapping-unavailable','Boundary owner mapping unavailable');
          return json(res,200,await changes.turnBoundary(matches[0].id,b.sessionId,host.token,b.turnId,b.phase,b.providerTurnId,b.status));
        } catch(e) { const err=e instanceof ChangesError?e:new ChangesError('invalid-input','Invalid turn boundary',400);return json(res,err.status,{error:{code:err.code,detail:err.message,retryable:err.status===409}}); }
      }
      const changeRoute=/^\/api\/agents\/([^/]+)\/changes(?:\/(.*))?$/.exec(url.pathname);
      if(changeRoute) {
        try {
          const agent=decodeURIComponent(changeRoute[1]),suffix=changeRoute[2]??'',session=url.searchParams.get('sessionId')??'';
          if(req.method==='GET' && suffix==='') {
            const kind=url.searchParams.get('scope')??'workspace';
            const scope={kind,...(url.searchParams.has('targetRef')?{targetRef:url.searchParams.get('targetRef')}:{}),...(url.searchParams.has('turnId')?{turnId:url.searchParams.get('turnId')}: {})} as ReviewScope;
            return json(res,200,await changes.preview(agent,session,scope));
          }
          if(req.method==='GET' && suffix.startsWith('files/'))return json(res,200,await changes.file(agent,session,url.searchParams.get('revisionId')??'',suffix.slice(6)));
          if(req.method==='GET' && suffix==='turns')return json(res,200,await changes.turns(agent,session));
          if(req.method==='GET' && suffix==='comments')return json(res,200,{comments:await changes.comments(agent,session)});
          if(req.method==='GET' && suffix.startsWith('feedback/'))return json(res,200,await changes.deliveries(agent,session,suffix.slice(9)));
          if(req.method==='POST') {
            const b=JSON.parse(await readBody(req));
            if(suffix==='comments')return json(res,201,await changes.createComment(agent,b));
            const resolve=/^comments\/([^/]+)\/resolve$/.exec(suffix);
            if(resolve)return json(res,200,await changes.resolveComment(agent,b.sessionId,resolve[1],b.reviewKey));
            if(suffix==='feedback')return json(res,202,await changes.dispatchReviewFeedback(agent,b));
          }
          return json(res,405,{error:{code:'invalid-input',detail:'Unsupported Changes endpoint/method',retryable:false}});
        } catch(e) {const err=e instanceof ChangesError?e:new ChangesError('store-unavailable','Changes observation failed; no clean-state claim',409);return json(res,err.status,{error:{code:err.code,detail:err.message,retryable:err.status===409}});}
      }
      return false;
    },
  };
}
