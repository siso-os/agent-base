# SISO packages

Shaan, 2 Oct 2026: "if you're drawing good stuff don't mind making s-i-s-o packages like for the side nav for the shell
for the components just so it's easily can be reused in future projects". These are those packages. Agent Base is the
first app built on them; nothing in them knows about agents or herdr.

| Package | What it gives you | Lifted from |
|---|---|---|
| `@siso/tokens` | `siso.css`: the SISO design values (`--crm-*`, `--siso-*`), the SISO CRM's `tokens.css` byte for byte (sha256 1fb51616…, it already called itself "@siso/tokens — THE single source of truth"). `tokens.css`: Tailwind 4 names mapped onto it, plus the four state colours | SISO CRM `product-app/src/styles/tokens.css` @552f83b |
| `@siso/shell` | `PillTabs` (title-bar tabs in a glass capsule, ⌘1-9 hints, arrival pulse), `LayoutSwitch` + `nextLayout` (▭ ◫ ⤢), `useResizable` + `ResizeHandle`, `MenuButton` / `MenuList`, `Rail` (a plain icon rail), `usePersisted`, `cn`; `shell.css` (capsule, tab, segment and panel materials in the CRM rail's language) | Codex (tabs, layout cycle), SISO CRM materials |
| `@siso/side-nav` | **`GroupedRail`: the SISO side nav** (glass rail, brand + name + collapse, ⌘K search, labelled groups, utility capsule, operator dock; `grouped-rail.css` is the CRM file byte for byte, sha256 87c0c20e…), `RailGroup`, `RailIcon`, `RailCapsule`, `RailDock`, `RailRow` + `SortableRail` (live rows with a status, drag to reorder), `rail-extras.css`; also `SideNav`, `StatusRow`, `Shelf`, `formatDuration`, `formatAge` | SISO CRM `GroupedRail` (Shaan, 2 Oct: "you didn't use our side nav principles"); T3 Code's row (MIT, @5cc99e1c); dnd-kit |
| `@siso/terminal` | `TerminalView`: xterm.js over any socket that speaks ttyd's framing (ttyd itself or a bridge), with fit, unicode11, WebGL, mouse reports and reconnect; `terminal.css` | Labs fork `siso/herdr/terminal-view.tsx` |
| `@siso/voice` | `VoiceHistory` (by day, search, app filter, expand to full text, copy, paging), `VoiceStats` (share-card ticket, words trend, hour rhythm, app bars, activity wall), `VoiceDictionary` (vocabulary, terms, replacements), `VoiceSettings` (transcription, behaviour, the record), `VoiceCalendar` (a month of dictation days for a side nav), `useVoiceDays`; talks to `/api/voice/*` from a `base` URL or `fetchJson`/`sendJson` adapters; the dictionary and settings write SISO Voice's preferences through the node | SISO Internal `domains-preview/pages/voice/` (History, Stats, Charts, adapter), re-skinned onto the tokens |

## Use them in an app

They ship TypeScript source (React 19, Tailwind 4, lucide-react as peers), so the app's bundler compiles them.

1. Add them. In this workspace: `"@siso/shell": "workspace:*"`. From another repo, pnpm can install a folder of a git
   repo: `pnpm add "github:sisodias/siso-internal-labs-agent-base#path:/packages/siso-shell"` (private repo, so the
   machine needs GitHub access). **Not tried yet**, and `@siso/side-nav` names `@siso/shell` as `workspace:*`, which
   only resolves inside this workspace; the first outside app is the moment to give them their own repo and versions.
2. In the app's CSS, after Tailwind:
   ```css
   @import "tailwindcss";
   @import "@siso/tokens/siso.css";
   @import "@siso/tokens/tokens.css";
   @import "@siso/shell/shell.css";
   @import "@siso/side-nav/grouped-rail.css";
   @import "@siso/side-nav/rail-extras.css";
   @import "@siso/terminal/terminal.css";   /* only if you use the terminal */
   @source "<path to the packages folder>";  /* a folder, not a glob: Tailwind must scan their classes */
   ```
3. Use them: `apps/web/src` is the worked example (`Sidebar.tsx` builds the SISO rail with agents as `RailRow`s,
   `TitleBar.tsx` builds on `PillTabs`, `App.tsx` lays out the panels and wires `LayoutSwitch` and `TerminalView`).

The side nav is the SISO CRM's, not a new design: when a SISO app needs a sidebar it uses `GroupedRail`, and changes to
the rail's look go into the CRM's file first, then are copied here byte for byte.

Rule for adding to them: a piece goes in a package when it carries no app knowledge (no herdr, no agent fields); the app
maps its data onto it. When a second app uses one, it moves to its own repo.
