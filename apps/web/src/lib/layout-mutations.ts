/**
 * Which DOM mutations can move a native browser view's slot. The faces (prism `.pf`, halo `.hf`) write CSS variables
 * into their own `style` every animation frame; counting those made webview.ts measure the whole page 30-60 times a
 * second while any working face was on screen (8 Oct: Agent Base's WebContent at ~50% CPU all day). A face's own style
 * never changes layout outside it: it is created at a fixed size, and inserting or removing one is a childList change.
 */
const FACE = ".pf, .hf";

export function movesLayout(record: Pick<MutationRecord, "type" | "attributeName" | "target">): boolean {
  if (record.type !== "attributes" || record.attributeName !== "style") return true;
  const target = record.target as Element | null;
  return !(typeof target?.closest === "function" && target.closest(FACE));
}

export function anyMovesLayout(records: readonly Pick<MutationRecord, "type" | "attributeName" | "target">[]): boolean {
  return records.some(movesLayout);
}
