import { createHash } from "node:crypto";
import { launchAgent } from "../agent-launch.ts";
import { getWorkspace, WorkspaceError } from "../worktrees.ts";
import type { WorkspaceReceipt } from "../../../host/src/worktree-contract.ts";
import { fromWords } from "../say-start.ts";
import { readBackendCatalog } from "../../../host/src/backend-artifacts.ts";
import { safeName } from "../../../host/src/service.ts";
import type { Route } from "./registry.ts";
import type { HttpRuntime } from "../server.ts";

export function agentLaunchRoutes(runtime: Pick<HttpRuntime, "ALLOWED_ORIGINS" | "json" | "launchRepo" | "moveToHost" | "readBody" | "registry" | "startAgent" | "startZero" | "workspaceAdapters" | "zeroStarting" | "claudeLaunchProfile">): Route {
  return {
    method: null,
    path: /^\//,
    async handle(req, res, _match, url = new URL(req.url ?? "/", "http://node")) {
      const { ALLOWED_ORIGINS, json, launchRepo, moveToHost, readBody, registry, startAgent, startZero, workspaceAdapters } = runtime;
      if (url.pathname === "/api/agents/start-codex" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let body: any;
        try { body = JSON.parse(await readBody(req)); safeName(body.name); } catch { return json(res, 400, { error: "Use a name of 1–64 letters, numbers, hyphens or underscores" }); }
        if (body.name.toUpperCase() === "A0") return json(res, 400, { error: "Choose a name other than A0" });
        const model = body.model;
        if (typeof model !== "string" || !model.trim() || model.startsWith("-")) return json(res, 400, { error: "An explicit model is required" });
        let backendCatalogId: string | undefined;
        if (Object.hasOwn(body, "backendCatalogId")) {
          if (typeof body.backendCatalogId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.backendCatalogId)) return json(res, 400, { error: "Choose a valid Codex version ID" });
          backendCatalogId = body.backendCatalogId;
          try {
            if (!readBackendCatalog().value.artifacts.some(a => a.id === backendCatalogId && a.provider === "codex")) return json(res, 400, { error: "That Codex version is not in the available catalog" });
          } catch { return json(res, 503, { error: "Codex versions are unavailable; retry or use the configured default" }); }
        }
        try { return json(res, 202, await launchAgent({ launchId: body.launchId, taskId: body.taskId, name: body.name, repo: launchRepo(body), project: body.project, harness: "codex", model, prompt: body.prompt, workspace: body.workspace, ...(backendCatalogId ? { backendCatalogId } : {}) }, workspaceAdapters)); }
        catch (e) { return json(res, e instanceof WorkspaceError ? e.code : 400, { error: e instanceof WorkspaceError ? e.message : "Cannot accept workspace launch" }); }
      }
      if (url.pathname === "/api/agents/start-zero" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        if (runtime.zeroStarting) return json(res, 409, { error: "Agent Zero is already starting" });
        runtime.zeroStarting = true;
        try { return json(res, 200, await startZero()); }
        catch (e) { return json(res, e instanceof WorkspaceError ? e.code : 502, { error: (e as Error).message }); }
        finally { runtime.zeroStarting = false; }
      }
      if (url.pathname === "/api/agents/start" && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        let body: unknown;
        try {
          body = JSON.parse((await readBody(req)) || "{}");
        } catch {
          return json(res, 400, { error: "not JSON" });
        }
        const b = body as any;
        // Every new chat requires the receipt protocol. Legacy calls cannot allocate a terminal or standing seat.
        if (b.launchId || b.workspace && typeof b.workspace === "object") {
          try {
            if (b.say && !b.name) {
              let saved: WorkspaceReceipt | undefined;
              try {saved=getWorkspace(`ws-${createHash("sha256").update(JSON.stringify(b.taskId ?? b.launchId)).digest("hex").slice(0,24)}`);}catch{}
              if(saved) {b.name=saved.name;b.project=saved.input.project;b.prompt=saved.input.prompt;}
            }
            if (b.say && !b.name) {
              const pick = fromWords(b.say, { projects: registry.projects, agents: registry.agents, taken: new Set(Object.keys(registry.agents)) });
              b.name = pick.name; b.project ??= pick.project; b.prompt ??= b.say;
            }
            safeName(b.name);
            const input = { launchId: b.launchId, taskId: b.taskId, name: b.name, repo: launchRepo(b), project: b.project, harness: "claude" as const, model: b.model ?? "opus", prompt: b.prompt, workspace: b.workspace, claudeProfile: runtime.claudeLaunchProfile() };
            return json(res, 202, await launchAgent(input, workspaceAdapters));
          } catch(e) { return json(res, e instanceof WorkspaceError ? e.code : 400, { error: e instanceof WorkspaceError ? e.message : "Cannot accept workspace launch" }); }
        }
        const r = await startAgent(body);
        return "error" in r ? json(res, r.code, { error: r.error }) : json(res, 200, r);
      }
      const mv = url.pathname.match(/^\/api\/agents\/([A-Za-z0-9_:-]+)\/to-host$/);
      if (mv && req.method === "POST") {
        const origin = String(req.headers.origin ?? "");
        if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "not this app" });
        const why = await moveToHost(mv[1]);
        return why ? json(res, 409, { error: why }) : json(res, 200, { ok: true });
      }
      return false;
    },
  };
}
