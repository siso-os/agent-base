import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { LifeMain, LifeSidebar, type LifeSelection } from "../src/components/LifeSpace";
import "../src/index.css";

// The Life space as it sits in the app (its side nav, then the page), against whatever answers /api/life/* on this
// origin: the UI suite (services/node/test/life-ui.mjs) serves an invented in-memory API there. No real life data.
function Preview() {
  const [sel, setSel] = useState<LifeSelection>(new URLSearchParams(location.search).get("sel") ?? "today");
  // On a phone the app shows the side nav as a sheet (Phone.css), not beside the page.
  const [narrow, setNarrow] = useState(window.innerWidth < 760);
  useEffect(() => { const resize = () => setNarrow(window.innerWidth < 760); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  return (
    <div className="flex h-full min-h-0 flex-col"><div className="border-b border-amber-400/20 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200">Synthetic preview · invented entries · no connection to your Life data</div><div className="flex min-h-0 flex-1">
      {!narrow && <LifeSidebar selected={sel} onSelect={setSel} />}
      <section className="relative flex min-w-0 flex-1 flex-col" aria-label="Life"><LifeMain selected={sel} onSelect={setSel} /></section>
    </div></div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
