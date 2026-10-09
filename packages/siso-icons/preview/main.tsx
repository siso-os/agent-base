import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { AnimatedNavIcon, ICONS, isIconName, type IconName } from "../src";
import "./preview.css";

if (isIconName("__not-an-icon__")) throw new Error("isIconName accepted a name outside ICONS");

const names = Object.keys(ICONS) as IconName[];

function Gallery() {
  return (
    <main data-icon-count={names.length}>
      <header>
        <div>
          <p className="eyebrow">SISO · COMPONENT PREVIEW</p>
          <h1>HALO animated icons</h1>
          <p>{names.length} pqoqubbw icons · Hover a row to play its glyph</p>
        </div>
        <span className="source">pqoqubbw/icons · MIT</span>
      </header>
      <section className="gallery" aria-label="Animated icon gallery">
        {names.map((name) => {
          const Icon = ICONS[name];
          return (
            <button className="icon-card" data-icon={name} key={name} type="button">
              <span className="icon-name">{name}</span>
              <AnimatedNavIcon icon={Icon} />
            </button>
          );
        })}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(createElement(Gallery));
