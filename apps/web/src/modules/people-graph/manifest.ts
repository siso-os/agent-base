/**
 * People graph (PEOPLE-GRAPH seat, Great_Library_of_SISO/people-graph): everyone we track, the videos they made, who said
 * what (verbatim, timestamped) and who they are in the 339k-person graph, plus a full doc and transcript per video.
 * Shaan, 15 Oct: "put a people graph module in the agent OS which loads from the cloudflare auto logged in", then "make a
 * people graph hub ... knowing kinda what the base dashboard looks and feels like". It draws itself (index.tsx) on the
 * dashboard's HubPage; its data comes through the node's /api/people/ door (people.route.ts, signed in server-side) and
 * /api/people-watch (people-watch.route.ts, the tracker on the Mac mini).
 */
import type { Module } from "@siso/os";

export default {
  id: "people-graph",
  name: "People",
  space: "agent-base",
  icon: "people-graph",
  order: 7,
  line: "Everyone we track: what they made, what they said, and who they are in the graph",
  entry: { kind: "builtin", component: "people-graph" },
  sidenav: "none",
  host: "local",
} satisfies Module;
