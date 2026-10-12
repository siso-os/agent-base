import type { Module } from "@siso/os";

/** The Rolodex now lives inside Communications as People (Shaan, 10 Oct: "Move Rolodex into WhatsApp"). Kept so old
 *  links to it still resolve: opening it opens Communications on People. No rail icon of its own. Private: never mirrored. */
export default {
  id: "rolodex", name: "People", space: "agency", icon: "rolodex", order: 1, rail: false,
  line: "Everyone you know, on six levels: in Communications",
  entry: { kind: "builtin", component: "rolodex" },
  host: "local",
} satisfies Module;
