import type { ReactNode } from "react";
import { HaloRim } from "@siso/shell";
import { ComposerFrame } from "../../../../packages/siso-composer/src/ComposerFrame";
import "./Composer.css";

/** Agent Base's existing API; the application owns acknowledgement identity and the shared package owns presentation. */
export function ChatRim({ working, accent, hud, children, acceptedReceipt }: { working: boolean; accent?: string; hud?: ReactNode; children: ReactNode; acceptedReceipt?: { key: string; text?: string } | null }) {
  return <ComposerFrame surface={HaloRim} state={working ? "working" : "idle"} hue={accent ? `rgb(${accent})` : undefined} hud={hud} acceptedReceipt={acceptedReceipt ? { ...acceptedReceipt, label: "Received by agent" } : null} data-testid="halo-rim" data-ab-comp="input-bar">{children}</ComposerFrame>;
}
