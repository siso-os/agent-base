import { createDonorWorkReader, type DonorWorkData } from "../donor-work.ts";
import type { Route } from "./registry.ts";

/** File/config selection belongs to the reader, never to URL/query/body input. */
export function donorWorkRoute(read: () => Promise<DonorWorkData> = createDonorWorkReader()): Route {
  return {
    method: "GET", path: /^\/api\/donor\/work(?:\/projects\/([^/]+))?$/,
    async handle(_req, res, match) {
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(value));
      };
      let id: string | null = null;
      if (match[1]) {
        try { id = decodeURIComponent(match[1]); } catch { return send(400, { error: "Invalid donor project ID" }); }
        if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) return send(400, { error: "Invalid donor project ID" });
      }
      const data = await read();
      if (!id || data.state === "unconfigured" || data.state === "unavailable") return send(200, data);
      const project = data.projects.find(p => p.ref.projectId === id);
      return project ? send(200, { ...data, projects: [project] }) : send(404, { error: "Donor project not in the reviewed snapshot" });
    },
  };
}
export const route = donorWorkRoute();
