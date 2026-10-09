import { retryLaunch } from "../agent-launch.ts";
import { archiveWorkspace, cancelPreparation, getWorkspace, snapshot, WorkspaceError } from "../worktrees.ts";
import { listServiceHosts } from "../service-hosts.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function workspacesRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "HOSTS_DIR" | "json" | "listAgents" | "registry" | "workspaceAdapters">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, HOSTS_DIR, json, listAgents, registry, workspaceAdapters } = runtime;
      if (url.pathname === "/api/workspaces/repos" && req.method === "GET") {
        const repos = registry.projects.filter(p=>p.path).map(p=>({id:p.id,name:p.name,path:p.path}));
        if(process.env.AB_FIXTURE_REPO) repos.unshift({id:"scratch",name:"Scratch repository",path:process.env.AB_FIXTURE_REPO});
        return json(res,200,{repos});
      }
      const workspaceRoute = url.pathname.match(/^\/api\/workspaces\/([A-Za-z0-9_-]+)(?:\/(retry|cancel|archive|events))?$/);
      if(workspaceRoute) {
        const [,id,op]=workspaceRoute;
        const origin=String(req.headers.origin??"");
        if(origin && !ALLOWED_ORIGINS.has(origin))return json(res,403,{error:"not this app"});
        try {
          if(req.method === "GET" && !op)return json(res,200,snapshot(getWorkspace(id)));
          if(req.method === "POST" && op === "retry")return json(res,202,retryLaunch(id,workspaceAdapters));
          if(req.method === "POST" && op === "cancel")return json(res,200,{cancelled:cancelPreparation(id)});
          if(req.method === "POST" && op === "archive")return json(res,200,await archiveWorkspace(id,async r=>{
            const hosts=await listServiceHosts({dir:HOSTS_DIR});
            return hosts.some(h=>h.name===r.name && h.state!=="down") || (await listAgents(0)).some(a=>a.name===r.name && !!a.pane);
          }));
          if(req.method === "GET" && op === "events") {
            getWorkspace(id);res.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-store"});
            let last=-1;
            const send=()=>{try {const next=snapshot(getWorkspace(id));if(next.sequence<=last)return;last=next.sequence;res.write(`event: workspace.snapshot\ndata: ${JSON.stringify(next)}\n\n`);}catch{res.end();}};
            const timer=setInterval(send,250);req.once("close",()=>clearInterval(timer));send();return;
          }
          return json(res,405,{error:"Unsupported workspace operation"});
        }catch(e){return json(res,e instanceof WorkspaceError?e.code:404,{error:e instanceof WorkspaceError?e.message:"Workspace receipt unavailable"});}
      }
      return false;
    },
  };
}
