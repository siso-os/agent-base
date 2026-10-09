import { AlarmClockOffIcon } from "lucide-react";
import { formatAge } from "@siso/side-nav";
import { AgentFace } from "../lib/face";
import type { Ended } from "../lib/ended";
import { HubPage } from "./page/HubPage";
import "./Ended.css";

/** The former sidebar shelf, retaining its rows and read-only chat action. */
export function EndedPage({ ended, activeId, onOpen }: { ended: Ended[]; activeId?: string | null; onOpen: (e: Ended) => void }) {
  return <HubPage id="ended-list" icon={AlarmClockOffIcon} title="Ended" blurb={`${ended.length} agents on record. Open one to read its chat.`}>
        <div data-testid="ended-group">
          {(ended).map((e) => (
            <button
              key={e.id}
              type="button"
              className={`ab-ended${activeId === e.id ? " is-active" : ""}`}
              data-testid="ended-row"
              data-name={e.name}
              title={`${e.name}${e.project ? ` · ${e.project}` : ""} · ended ${new Date(e.ended).toLocaleString()}${e.task ? ` · ${e.task}` : ""}`}
              onClick={() => onOpen(e)}
            >
              <span className="ab-ring is-offline">
                <AgentFace name={e.name} project={e.project ?? undefined} status="offline" size={18} />
              </span>
              <span className="ab-ended__name">{e.name}</span>
              <span className="ab-ended__task">{e.task || e.project || ""}</span>
              <span className="ab-ended__age">{formatAge(e.ended)}</span>
            </button>
          ))}
        </div>
    {!ended.length && <p className="text-sm text-muted-foreground">No ended agents on record.</p>}
  </HubPage>;
}
