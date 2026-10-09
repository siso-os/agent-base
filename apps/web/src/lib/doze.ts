/**
 * t-0237 (2 Oct 21:21: the app idle on screen held WebKit at ~27-40% CPU): once nobody has touched the window for
 * DOZE_MS, or it is hidden, the page dozes. Every CSS animation (working rings, spinners) holds its frame
 * (index.css, :root[data-doze]) until the next pointer move, key or scroll. The faces doze the same way on their own
 * (packages/halo-face/halo-face.js).
 */
export const DOZE_MS = 20_000;

const root = document.documentElement;
let last = performance.now();
let armed = false;

function check() {
  armed = false;
  const left = DOZE_MS - (performance.now() - last);
  if (left <= 0) root.dataset.doze = "";
  else arm(left);
}
function arm(ms: number) {
  armed = true;
  window.setTimeout(check, ms);
}
function input() {
  last = performance.now();
  if ("doze" in root.dataset) delete root.dataset.doze;
  if (!armed) arm(DOZE_MS);
}

for (const t of ["pointermove", "pointerdown", "keydown", "wheel"]) window.addEventListener(t, input, { passive: true, capture: true });
document.addEventListener("visibilitychange", () => (document.hidden ? (root.dataset.doze = "") : input()));
arm(DOZE_MS);
