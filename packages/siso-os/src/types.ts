/**
 * SISO OS's app model (ecosystem/specs/siso-os.md §4): a space is a group on the rail, a module is one capability with
 * one manifest. The shell draws the rail, the side-nav slot and ⌘K from these; a module's code loads only when opened.
 */
export type SpaceId = "agent-base" | "app-factory" | "agency";

export type Space = { id: SpaceId; name: string; icon: string; colour: string; order: number };

/** Where a module's screen comes from: a built-in component the app names, or a page at a URL shown in a frame. */
export type ModuleEntry = { kind: "builtin"; component: string } | { kind: "url"; url: string };

export type Module = {
  id: string;
  name: string;
  /** Its space, or "os" for what every space uses (the Library, Questions): those sit at the bottom of the rail. */
  space: SpaceId | "os";
  icon: string;
  order: number;
  entry: ModuleEntry;
  /** "avatar": opened from his avatar at the foot of the rail instead of an icon (Life). */
  dock?: "avatar";
  /** One line for the rail's hover card and ⌘K. */
  line?: string;
  sidenav?: { kind: "builtin"; component: string } | "none";
  /** A URL module's ↻ over its frame; false when the app draws its own controls there (SISO Code's sidebar toggle). */
  frameReload?: boolean;
  /** A URL module whose frame stays loaded, hidden, once opened, so leaving it does not stop it (Music keeps playing). */
  keepAlive?: boolean;
  /** Its PagesNav. */
  pages?: { id: string; name: string; icon: string }[];
  /** Into ⌘K. */
  commands?: { id: string; title: string; keys?: string }[];
  /** Source of "needs you" items. */
  attention?: string;
  /** Runs on this machine, or on any host. */
  host?: "local" | "any";
  /** What its public mirror gets; absent = private, nothing leaves the laptop (§2, idea 33). */
  mirror?: { data: string[] };
  mcp?: string;
  appfactory?: string;
  /** Hidden from the rail and ⌘K unless the app turns it on (a module still being built, or a private one). */
  hidden?: boolean;
  /** false: no icon of its own on the rail. Its space's head opens it (Agents under Agent Base, App Factory under its
   * space), or ⌘K reaches it (Tasks). Shaan, 10 Oct: "agents base and agents has two ... a wasted tasks one". */
  rail?: false;
};
