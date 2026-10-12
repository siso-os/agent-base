import { useEffect, useState } from "react";
import { load, save } from "@siso/shell";
import { LifeMain, LifeSidebar, type LifeSelection } from "./LifeSpace";

/** Life (siso-os.md §5, under Shaan's avatar): its own state, its sidebar while the side nav is open. */
export default function LifeModule({ sidebarOpen }: { sidebarOpen?: boolean }) {
  const [selected, setSelected] = useState<LifeSelection>(() => load("life-sel", "today"));
  useEffect(() => save("life-sel", selected), [selected]);
  return (
    <>
      {sidebarOpen && <LifeSidebar selected={selected} onSelect={setSelected} />}
      <section className="relative flex min-w-0 flex-1 flex-col" aria-label="Life">
        <LifeMain selected={selected} onSelect={setSelected} />
      </section>
    </>
  );
}
