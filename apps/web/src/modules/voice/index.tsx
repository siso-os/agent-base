import { useEffect, useState } from "react";
import { load, save } from "@siso/shell";
import { VoiceMain, VoiceSidebar, type VoiceSelection } from "./VoiceSpace";

/** Voice (siso-os.md §3): its own state (which page is open), its sidebar while the side nav is open. */
export default function VoiceModule({ sidebarOpen }: { sidebarOpen?: boolean }) {
  const [selected, setSelected] = useState<VoiceSelection>(() => load("voice-sel", "home"));
  useEffect(() => save("voice-sel", selected), [selected]);
  return (
    <div className="vx-space">
      {sidebarOpen && <VoiceSidebar selected={selected} onSelect={setSelected} />}
      <section className="relative flex min-w-0 flex-1 flex-col" aria-label="Voice">
        <VoiceMain selected={selected} />
      </section>
    </div>
  );
}
