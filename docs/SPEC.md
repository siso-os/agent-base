# Agent Base: the build spec

Written 2 Oct 2026, about 00:30 +07, by the AGENT-BASE owner session (herdr tab, Claude session `25dfb4b2`), so the
session can be compacted and resumed cold. Everything Shaan decided is here with his words; everything verified says
how. If this file and his words in `siso-internal-labs-agents/intent/` disagree, his words win.

## 1. What we are building

Shaan's own agentic coding app, "Agent Base": one window he lives in all day. Agent Zero is pinned on top, every agent
has its own clean terminal and its own page, the fleet shows as an org chart, docs wait for his click, and he improves
the app while using it. It replaces today's Agent Base page on sisolabs.space.

- The canonical list of what he wants (104 wants, every one in his words, none undrawn):
  `siso-internal-labs-agents/.agents/research/2026-10-01-agent-app/INTENT.md` (built by `intent-map/build.py`).
- The screens: `…/2026-10-01-agent-app/wireframes.html`, **v0.6** (19 screens: 1, 1A·1B, 1C, 1D, ◐, 2, 2B, 3, 3B, 4,
  5, 5B, 6-12, ⚙, ?). Posted at http://127.0.0.1:8891/card/agent-base-mupi8i6v/html. Screen ◐ is the look and feel;
  screen 1 is the main window; 1D is the chat view.
- The findings and every research report: `…/2026-10-01-agent-app/findings/` (page
  http://127.0.0.1:8891/card/agent-base-mupii6o4/html), `ui-rob/{t3code,orca,codex}/REPORT.md`, `tests/*/REPORT.md`,
  `reports/bridgemind-complete.md`, `reports/github-complete.md`.

## 2. Decisions (locked; change only on his word or a failed test named here)

| Decision | His words | Why |
|---|---|---|
| **Our own thin base; T3 Code is the source of UI pieces, not the base** | "Do we build our base first or do we use one of these guys's base like T3 code as a base" (1 Oct 17:18 UTC); answered from first principles | A base is worth taking only when its spine matches ours. T3's server starts and owns each agent (one person's threads, one machine); ours is a window onto agents herdr already runs across machines. T3 covers ~15-20 of the 104 wants. Its UI is the valuable part and is portable (MIT, React + Tailwind; it renders identically in WebKit and Chrome, tested 1 Oct). **Revisit only if** lifting T3 pieces costs more than about a day each; measure on the first piece (the sidebar row) and report the number. |
| **Tauri (Rust), not Electron** | "Electron app's cool, but like a Rust app would always be better" (1 Oct 16:54 UTC) | Lighter; SISO Internal is already Tauri 2.11. Tauri's Chromium runtime is unfinished on macOS (Oct 2026), so agents driving an in-window Chromium tab waits for the Web stage (7): either that runtime, or the Web space as its own Chromium window. Phase 1 needs no Chromium. |
| **Not greenfield: lift the Labs fork's herdr-native parts and SISO Internal's shell** | "this is not a complete Greenfield build" (16:54) | §5 lists every part. Lift parts, not the messy Labs page layout he disliked. |
| **Screens and laptop terminals local; everything else stays on the VPS** | "should it just be streaming from the VPS … Or are we over engineering?" (17:19 UTC) | Measured in `~/.local/share/siso-agent-base-local/edge.mjs`: VPS 248 ms away, a laptop keystroke took ~0.5 s through it, a click on a laptop agent 1.6 s; "The lag was the route, not the server." The edge already runs laptop terminals locally. VPS keeps records, VPS agents, phone, other machines, token tracker. Phase 1 needs no new VPS work. |
| **One Opus builds it end to end** | "one opus going through this would probably do it much better than a bunch of smaller subs" (17:08 UTC) | Usage is not a constraint ("basically unlimited astro and lunar"). Astra/Luna Codex lanes only if one genuinely helps. Memory: `.agents/memory/agent-base-one-opus-builds.md`. |
| **Good parts become SISO packages** | "if you're drawing good stuff don't mind making s-i-s-o packages like for the side nav for the shell for the components just so it's easily can be reused in future projects" (1 Oct 17:52 UTC) | `packages/` holds `@siso/tokens`, `@siso/shell`, `@siso/side-nav`, `@siso/terminal`, free of agent or herdr knowledge; the app maps its data onto them (`packages/README.md`). They move to their own repo when a second app uses one. |
| **The side nav wears the SISO side nav's materials (the SISO CRM's GroupedRail)**; its layout is option B below | "you didn't use our side nav principles Which just makes shit look way nicer" (2 Oct ~01:10 +07, first look at the window); earlier: "exactly how the side nav works is how our shit should work" (12 Sep) | `@siso/side-nav` `GroupedRail` is the CRM component with its CSS and tokens byte for byte; agents are rows in it, dragged into his own order as in herdr ("you should be able to drag and drop those guys around to reorder them like herder"). |
| **Side nav = option B: agents by who they work for, never by folder** | "i do hate these weird folders based on where they're open … get them to name themselves … and have a db to track them" and "B is quite good" (2 Oct ~01:40 and ~02:00 +07) | Pinned on top, then a section per domain from the agent table, each lead with its crew folded under it; a crew member opens beside its lead's chat. All machines in one side nav ("that should all be merged into one side nav because agent zero will still be controlling all of them"). Options page: `siso-internal-labs-agents/.agents/research/2026-10-01-agent-app/side-nav-options/`. |
| **The top bar is tabs, cmux's way: the chat, then that agent's own pages, then his pinned pages** | "the agent also has its own url save so when you click on them it has its own personal urls and then i can have urls pinned" (2 Oct ~02:00); "I like it full-width … if you want to drag and drop it, it can go split-screen with my chat" (~01:40) | A page fills the frame; dragged onto the chat it splits. An agent's pages are what it saved plus what it posted to the console (matched by its name or Claude session); no new habit for agents. |
| **The chat runs Claude through the Agent SDK inside a herdr pane** | "Yeah, I don't really want stuff to show 1 to 5 seconds late … I would low-key want to own maybe the input box" (2 Oct ~01:30) | Tested on the lab (`…/t3-chat/host.mjs`): typed text 58 ms, words stream live, herdr still lists and tracks it (report as agent `siso`, hide `HERDR_ENV` from the child), `claude --resume` takes it back to the terminal. T3's adapter is the parts list for the rules. Not built into the app yet. |
| **Stop re-deciding** | "you keep on going backwards and forth" | Decide once from first principles, then build. |
| Rail and dropdown both; every agent has a page, Agent Zero's is the one he watches; New chat is "say it", Agent Zero places the agent; no Plane underneath; no login prompts; herdr stays the engine | 1 Oct, in INTENT.md "Calls made" | |

## 3. Architecture

```
siso-internal-labs-agent-base/        (this repo; GitHub sisodias/siso-internal-labs-agent-base, private)
  apps/desktop/      Tauri 2.11.5 window. Starts services/node (SISO Internal's lib.rs pattern), opens the node's page.  — BUILT, TESTED HIDDEN
  apps/web/          Vite + React 19 + Tailwind 4: the screens. Maps agents onto the @siso packages.                  — SCREEN 1 BUILT, TESTED
  services/node/     The laptop node: herdr agent list + status + context %, agent read, row state, terminal bridge.   — BUILT, TESTED
  packages/          @siso/tokens, @siso/shell, @siso/side-nav, @siso/terminal: reusable, no agent knowledge.        — BUILT (packages/README.md)
  docs/SPEC.md       This file.
  docs/SPEC.md       This file.
```

NOT `sisodias/siso-agent-base`: that is the old Agent Base, retired and read-only (SISO Internal AGENTS.md). Never write to it.

Later (after phase 1): `services/hub/` (VPS: event log in Postgres, agent API, relay, keys; until then the Labs fork's
Django API on the VPS serves VPS agents), `packages/contracts/`, `packages/widgets/` (HALO widget framework), `cli/base`.

Run it: `pnpm install`, `pnpm build` (the screens), then either `apps/desktop/target/release/bundle/macos/Agent Base.app`
(built with `cd apps/desktop && cargo tauri build --bundles app`) or `pnpm web` + `pnpm node` for the browser
(http://127.0.0.1:5410). The app runs from this checkout in phase 1: the node and the built screens are found beside the
crate, not bundled inside it.

## 4. The laptop node (services/node): built and verified

`services/node/src/server.ts`, run with `node --experimental-strip-types` (Node 22). Endpoints:

- `GET /api/health`
- `GET /api/agents`: every herdr agent: `{id (terminal_id), pane, name, title, status, since, tool, cwd, project, machine, session, context, zero}`.
  - status words: herdr `working`→working, `blocked`→needs (Needs you), `done`→done, `idle`→idle; `since` = when this node saw the state begin (the timer in "Working 17m").
  - context % is read from `~/.local/state/context-ping/ctx/<session>.json` (`used_percentage`), written by the HUD.
  - Agent Zero = title starting `A0` or cwd ending `/agent-zero/siso-firstmate`.
- `GET /api/agents/:id/read?lines=40`: `herdr agent read <pane>` (it takes the pane id, not the terminal id; the node maps one to the other from the last list).
- `POST /api/agents/:id/{settle,unsettle,snooze?until=<ms>,unsnooze,seen}` and `POST /api/order {ids}`: what Shaan did to a row, kept in `~/.local/state/agent-base/rows.json` (`AB_STATE`); `/api/agents` returns `row` (live/settled/snoozed), `snoozedUntil`, `settledAt`, `seenAt`, `order` and `key`. herdr is never written.
  - **Kept by machine + name** (`key`, e.g. `laptop/STREAMING-CLAUDE`), never by terminal id: a herdr restart gives every terminal a new id, and on 2 Oct morning that wiped his settled rows and drag order. The app still sends terminal ids; the node maps them. A second agent with the same name gets `#<terminal id>` appended. `sessions` remembers each key's Claude session, so a row follows an unnamed chat whose title (Claude's summary) changes. A file from before is moved to names on load from herdr-resurrect's snapshots (`AB_RESURRECT_DIR`), then from the live list; ids found in neither are dropped. His pre-restart entries could not be recovered (the snapshots that held them had rotated off; herdr's log has ids without names), so the 3 settled rows and the drag order need redoing once; the old file is kept at `rows.json.bak-2026-10-02-terminal-ids`.
  - **Checked**: `services/node/test/rows-survive.mjs` provisions its own lab session, settles, snoozes, marks seen and orders three named fake agents, restarts herdr (new terminal ids, as on 2 Oct) and the node, and sees all of it come back; also the snapshot migration, a retitled chat keeping its row, and a 404 for an unknown id. 6 of 6 (2 Oct ~12:55 +07). Live node restarted on it: 16 agents keyed by name.
  - **Both state files are safe against other writers and bad files** (`services/node/src/store.ts`, for rows.json and registry.json): the node re-reads a file that changed on disk before every change (it used to rewrite it from memory, so a second node, a check or a seed script lost its change; a likely way his four pinned pages vanished before 12:36), moves a file that does not parse aside as `<file>.bad-<ms>` instead of starting empty and wiping it, and copies each file to `backups/<name>-YYYY-MM-DD.json` on the first save of the day (14 kept). The same check adds 3: a second writer's change survives, a corrupt file is kept aside, backups are written: **9 of 9** (2 Oct ~13:10 +07).
- Started by the desktop app with `AB_PARENT_PID`, it exits within a second of the app going away (quit, crash or kill).
- `WS /term/:terminalId/ws`: spawns `herdr terminal attach <id> --takeover` in node-pty and speaks **ttyd's framing** so the Labs terminal view works unchanged. First client message `{columns, rows}`; then client `'0'+input` (text frames UTF-8, binary frames raw mouse bytes) and `'1'+{columns,rows}`; server `'0'+output`.
- Serves `apps/web/dist` when built.
- Config: `AB_PORT` (5401), `AB_HOST`, `AB_HERDR` (command prefix, default `herdr`), `AB_CTX_DIR`, `AB_WEB_DIST`, `AB_MACHINE` (MB).

**Verified 2 Oct 00:25-00:30 against an isolated herdr lab session** (never live agents; see §8):
- `/api/agents` listed the three lab agents with the right words: alpha working, charlie needs (blocked), bravo idle.
- `test/term-probe.mjs`: attached to alpha over the socket, typed a line, the agent's echo came back in **20, 3 and 19 ms**.
- node-pty needed its `spawn-helper` made executable (`posix_spawnp failed` otherwise); `postinstall` in `services/node/package.json` does it.

## 5. What gets lifted (the parts list)

| Part | From | Into | State |
|---|---|---|---|
| Real terminal (xterm.js + fit + unicode11 + WebGL, ttyd framing, reconnect, mouse via onBinary) | Labs fork `apps/web/core/components/siso/herdr/terminal-view.tsx` (GitHub sisodias/siso-internal-labs, branch `siso/main`) | `@siso/terminal` | Lifted (no observer or Plane `cn`; caller passes the socket path) |
| ANSI, machine card, attach/probe rule ("a click is not a poll"), herdr types | Labs `…/siso/herdr/{ansi.ts,machine-card.tsx,attach.ts,types.ts}` | apps/web | To lift |
| Agent board/panel, Agent Zero view, terminal dock, outputs, pinned strip, machine board | Labs `…/siso/agents/*`, `…/siso/orca/*` | apps/web pages | To lift selectively (the layout is the messy page; take parts) |
| Grouped rail with animated icons, sidebar icon rows | Labs `…/siso/{grouped-rail,animated-rail-icons,sidebar-icon-rows}.tsx` | apps/web rail | To lift |
| Token tracker UI (devices, leaderboard, usage chart, budgets) | Labs `…/siso/tokens/*` | Accounts (5B), later | Later |
| Labs coupling to remove | 55 files, 11,644 lines; 26 import `@plane/utils` (mostly `cn`), 30 `mobx` observer, 10 `@plane/propel`, 4 `@plane/ui`, SWR (keep) | | Shallow; mechanical |
| Chat view from session files (900 lines, no deps) | `…/2026-10-01-agent-app/tests/2-chat-view/{chatview.mjs,normalize.mjs,page.html}` | node + 1D | Later phase |
| Sidebar row, folded work log, composer pills, approval card, changed-files card, dock of surfaces, motion (150 ms rows, 0 ms panels) | T3 Code, clone `~/SISO_Workspace/_reference/t3code` @ `5cc99e1c` (MIT): `apps/web/src/components/{Sidebar.tsx,Sidebar.logic.ts,Sidebar.motion.ts,AnimatedHeight.tsx,RightPanelTabs.tsx,chat/*}` | apps/web | Row lifted (`@siso/side-nav` StatusRow), under 10 minutes; the rest to lift as screens need them |
| Agent card anatomy, status vocabulary, usage meters in the bar, ⌘J palette, phone key bar | Orca, clone `~/SISO_Workspace/_reference/orca` @ `dc08ffe` (MIT), paths in `ui-rob/orca/REPORT.md` | apps/web | Design reference; lift where it beats T3 |
| Next-needs-you ⌥⌘A, hover actions, ⌘⇧B layouts, sizes (sidebar 240-520/275, right 340), title-bar pill tabs | Codex bundle 26.928.21956 (read only), `ui-rob/codex/REPORT.md` | apps/web | Design reference (not code) |
| Tauri shell pattern (launch Node sidecar, log dir, app data) | SISO Internal `codebase/src-tauri/src/lib.rs` (231 lines), `tauri.conf.json` | apps/desktop | To adapt |
| herdr socket client in TypeScript; typing guard; undo toast | openrig (Apache-2.0) `packages/daemon/src/domain/terminal/herdr-*.ts`, `seat-delivery-guard.ts` | node, later | Later |
| One pane per view over herdr's sockets (alternative to attach) | roamgate (MIT) `server/src/bridge/*` | node | Only if attach's resize takeover hurts |
| Shaan's UI-bank picks with his notes: `pill-morph-tabs`, `tabs-base` ("really cool"), `action-dropdown` ("quite cool"), `apple-spotlight` ("beautiful"), `dashboard-sidebar` ("completely closes") | `~/SISO_Workspace/Great_Library_of_SISO/banks/siso-component-bank/{source,recovered}/<id>/code.tsx` (all real, none are stubs) | design lab | Candidates |

## 6. Phase 1: the first clickable window (the plan, in order)

1. **apps/web skeleton**: Vite + React 19 + Tailwind 4, the ◐ tokens (sidebar #000, page #0a0a0a, raised #161617,
   action #4a6cf7; working #38bdf8, needs #f0b03f, failed #ef5b4c, done #34c38f; greys for everything else).
2. **Sidebar (screen 1 + ◐)**: rail (52 px; Home live, other spaces dimmed), "Agent Base ▾", Agent Zero pinned,
   New chat ⌘N, agents sorted by who needs you then latest change, one status word with a live timer, Settled and
   Snoozed shelves, hover actions. **Lift T3's Sidebar row first and record the hours (the §2 test).**
3. **Terminal**: lift the Labs terminal view; tabs as rounded pills in the title bar (Codex); every opened tab stays
   mounted so switching is instant; ⌘1-9, ⌥⌘A next agent needing you, ⌘⇧B layouts (▭ ◫ ⤢).
4. **Right side**: dock (Page, Files, Changes, Agents, +). Agent Zero's page = its existing page at
   http://127.0.0.1:8892/ in a frame. Other agents: summary card (status, project, cwd, context %, session) and their
   recent output (`/api/agents/:id/read`).
5. **apps/desktop (Tauri)**: window loads apps/web, starts services/node. `cargo` lives in `~/.cargo/bin` (1.94.1), plus `cargo-tauri`.
6. **Checks**: headless WebKit and Chromium screenshots of every state against the lab; typing echo through the window;
   switching time between two open tabs; zero page errors. Then Shaan clicks it.

**Where phase 1 stands (2 Oct, 00:50 +07): steps 1-5 built, step 6 checked headless; Shaan has not clicked it yet.**

- The T3 test (§2): reading T3's `SidebarThreadRow` started at 00:28; the lifted row was rendering in a headless browser
  before 00:37. Under 10 minutes against a limit of about a day, so T3-as-parts holds. What made it cheap: lift the row's
  markup, class model and behaviour, drop its stores; the row is now `@siso/side-nav` `StatusRow`.
- Checked in headless Chromium and WebKit against the lab node (`ab-shot.mjs`, scratch): three agents sorted by who needs
  you (charlie Needs you, alpha Working, bravo); two tabs opened with live terminals (`data-status=open`); text typed in
  the window reached the agent (its recent output shows `alpha got: via-window-webkit`); switching between two open tabs
  took **24 ms in WebKit** (the engine Tauri uses) and 135 ms in headless Chromium (software rendering); hovering a row
  shows Snooze and Settle; Settle moved alpha to the Settled shelf; ⌘⇧B steps the layout; **zero page errors** in both.
  The terminal draws with WebGL, so the echo time through the window is not readable from the page; the socket-level
  echo stays 3-20 ms (§4).
- The desktop app: `cargo build` green; run hidden (`AB_HIDDEN=1`, no window, no Dock icon) against the lab, it started
  its own node, and its WebKit process connected to it (the page loaded and polled). A hard kill of the app took the
  node with it (`AB_PARENT_PID`), and the release `Agent Base.app` (built 00:57, `cargo tauri build --bundles app`),
  quit through macOS, did too. Not yet seen: the visible window itself (traffic lights over the bar, dragging), which
  is Shaan's first click.
- Known: the lab's panes are named against their scripts (herdr calls w1:p2 "charlie" but it runs the bravo script); the
  app shows what herdr says, so it is a lab artifact, not a bug.

Bottom bar in phase 1: model and context % from the context files; Claude 5h/week limits wait for request **R-0009**
(siso-hud.mjs writes rate_limits per profile; filed with the agent stack) and say so.

**First look (2 Oct, ~01:10 +07).** Shaan opened it on his live agents and opened six of them himself. His words:
"Definitely a lot faster. I'm liking the speed", and the look was "kind of a shit base" because it did not use the SISO
side nav. Redone the same night:
- The sidebar is the SISO CRM rail.
- Tabs sit in a glass capsule with no scrollbar.
- New chat and Needs you sit in the rail's utility capsule.
- Agents can be dragged into his order (saved by the node).
- The red "Can't reach the node" box is now a quiet line in the dock, shown after three failed reads in a row.
- Timers survive restarts.
- A ⌘ shortcut can no longer type its letter into an agent (a "b" landed in an agent's prompt once during testing; it was deleted before anything was sent).

Tab switching measured 49 → 31 ms in WebKit after compositing the rail's glow.

**Second look (2 Oct, ~01:30 +07): the Codex frame.** "the UI is looking better, but you can remove the notifications
and the plus thing in the side nav, and I like how … ChatGPT did their side nav … the icons were vertically on the left
hand side … they've got a top bar spare up there, and then it's like Everything's wrapped in a smaller bar" (his
screenshot was the Codex app). Now `@siso/shell` `AppFrame`:
- the top bar holds the sidebar toggle, the tabs and the layout control;
- the spaces sit as icons down the left on the darker canvas, with his orb at the foot (red dot when herdr is not answering);
- the sidebar and the work sit inside one rounded frame;
- the sidebar (`@siso/side-nav` `SideNav`) keeps the SISO row materials and drag to reorder, and loses the bell and the plus.

He overruled the wait ("I beg you just do this"); it was reloaded on his live agents at ~01:25 and looks right.

**Third look (2 Oct, ~01:40 +07): clean it up the Codex way, from first principles.** "It's better, it's just not as
clean as ChatGPT's thing … maybe we don't need the pills up top … that wrapper thing it should maybe be like a drop down
summary card … our side naps hella messy maybe the chat should just have like one line". Why it was less clean, as
answered: every row said five things where Codex says one; everything was said twice (tabs repeated the sidebar, the
bar repeated Claude's own footer, the right panel repeated the terminal); and there was too much chrome. Now:
- **No tabs.** The sidebar is the list. The top bar names the open agent ("Agent Zero  siso-firstmate · MB"). The last
  8 agents opened stay attached, so switching is still instant; ⌘1-9 count down the sidebar.
- **One line per agent** (`ThreadRow`): the mark (a turning ring while working, a dot for needs you / done / failed),
  the name, and the timestamp. Hover swaps the timestamp for Snooze and Settle. Agents sit in **project folders**
  (`ProjectGroup`, Codex's Projects list), dragged into his order inside each folder.
- **Summary card** (`SummaryCard`, ⌘⇧B or the top-right button) drops open over the top right: status, project and
  machine, model and context, the chat's cost; Agent Zero's page and Recent output open a **side panel** with a title
  bar, a full-screen switch and a close (Esc). Sub-agents and outputs say "from the session file", next.
- **The bottom bar is his Claude HUD** (his words, 01:45: "the model … tokens in, tokens out … the 5 hour limit, and
  the weekly limit and how many hours and minutes left … the amount of money spent on that chat"): model, context bar,
  tokens in/out, cache, 5h % (time left), weekly % (time left), $ for the chat. siso-hud.mjs now writes model, cost and
  rate limits into the per-session file it already wrote (R-0009, one line, additive; the context pings read the same
  fields as before). Checked on screen against Claude's own footer: the same numbers.

### Option B, built 2 Oct (~02:30 +07)

- **The agent table** (`services/node`, `AB_REGISTRY`, default `~/.local/state/agent-base/registry.json`), keyed by the
  agent's own name so it survives herdr restarts: domain, lead, role; his pins; pages saved to an agent; his pinned
  pages. One endpoint, `POST /api/registry {op}`: `register` (agents name their domain, lead, role), `move`, `pin`,
  `unpin`, `save-page`, `forget-page`, `pin-page`, `unpin-page`. Bad input gets a 400 with the reason. Seeded live with
  Agent Base; HALO · Streaming (STREAMING-CLAUDE leading OPS-BUILD, OPS-WORKSPACE, STREAM-A, STREAM-B, AUTO-VIEWER, from
  its brief); HALO · CRM (HALO-UI, and HALO-FACE placed by its folder, for Agent Zero to confirm).
- **Side nav**: Pinned, then one section per domain, then Unsorted; a lead has a fold and a count, its mark is the
  loudest of its team (a crew member that needs him lights the lead). ⋯ on hover: Pin, Move to each domain, Snooze,
  Settle. Drag reorders leads; crew ride with their lead. A crew row opens beside the lead's chat ("Open as the chat").
- **Top bar**: the side-nav toggle, then tabs (`TopTabs` in `@siso/shell`): the open chat, its pages (saved, then
  console posts), a divider, his pinned pages (seeded from his cmux tabs), + to pin a URL. A page fills the frame and
  the side nav steps aside; dragging a page tab onto the chat, or "Beside the chat", splits it. ⌘⇧[ ⌘⇧] step tabs.
  The chat's name, domain, lead and machine moved into the chat head with the summary toggle.
- **Checked**: 15 of 15 in headless WebKit on the lab (`siso-internal-labs-agents/.agents/research/2026-10-01-agent-app/option-b/check.mjs`);
  the screenshots caught a clipped ⋯ menu the checks passed, fixed. Live window screenshot after reload: the real tree,
  STREAMING-CLAUDE's own page as a tab, his four cmux pages pinned.
- **Not yet**: other machines (herdr has no saved machines here, so there is nothing to merge yet; the node tags each
  agent with its machine and the side nav already ignores machine), websites that refuse frames (most outside sites;
  needs Tauri's multi-webview), agents registering themselves at spawn (the endpoint exists; the spawn tools do not call
  it yet), Rename.

### Round 3, built 2 Oct (~02:30 +07)

His notes after option B went live, all built: ⋯ menus with an icon per item, no snooze, one "Move to…" that opens the
domains (menus now draw in a portal, so nothing clips them); page tabs get ⋯ with Pin and Remove (a console page is
hidden for that agent, `hide-page`); domains are folders again (icon, open and close) and leads have no fold; a crew
row opens that agent as the chat ("i do want only one pane per thing"); from the summary card the crew open in a
Codex-style right panel (a Crew chip, a back arrow, name, model and status). The card has a **Stats** drop-down and a
**Sub-agents** section shown even at zero (crew in herdr, and sub-agents this chat started), from
`GET /api/agents/:id/stats`, which reads the chat's own Claude session file incrementally (52 MB in 0.19 s, then 9 ms);
"All stats" opens the Stats page (totals, output per hour, tools, skills, sub-agents, models). The side nav has an
**Agents | Servers** switch; Servers lists the estate's machines (`GET /api/machines`, from
`SISO_Agents/siso-estate/plan/machines.json`) with agents under the MacBook. The rail's mic is the **Voice** space:
his SISO Voice history and stats, read-only (`services/node/src/voice.ts`, `@siso/voice`, spec in
`siso-internal-labs-agents/.agents/research/2026-10-01-agent-app/voice/SPEC.md`). App icon: the gold lion.
The browser is specced, not built (`…/browser/SPEC.md`: WKWebView child webviews with a data store per profile; a
30-minute Google sign-in gate first). Checked: 14 of 14 agent checks and 7 of 7 voice checks in WebKit on the lab.

### The SDK chat, rebuilt 2 Oct (~13:30 +07)

His words: "the CLI is really clean … what you're doing is just ugly" (13:00) and "formatted output. Kind of like how
Notion is" (13:21). Five harness studies first (`siso-internal-labs-agents/.agents/research/2026-10-01-agent-app/chat-study/`:
claude-cli, t3code, codex, orca, opencode, conductor, cursor), then the rule for each thing (table on the page below).
- **Host** (`services/host/src/host.ts`): sends tool inputs (commands, edit old/new) and output heads, thinking
  (summarized: `thinking: {type: "adaptive", display: "summarized"}`), sub-agent messages tagged `parent`, a live task
  table (type, tokens, tool uses, last tool, elapsed) and the background list; history restores times and the messages
  taken mid-turn (`queued_command` attachments) from the session file. Messages sent while Claude works carry a uuid;
  the SDK folds them into the running turn at the next tool boundary and says so with `command_lifecycle`
  (queued → started); `cancelAsyncMessage` (untyped, in the runtime) takes one back; `stopTask` stops a background job.
  `--replay SESSION` shows a session read-only for checks.
- **Web** (`apps/web/src/lib/chat.ts` lays it out, `ChatView.tsx` draws it, styles in `@siso/shell`): finished turns fold
  to "Worked for … · done HH:MM"; runs to one counted line in the CLI's words; the answer is a document; edits are
  diffs; "✻ Thought for 2s"; sub-agent cards open a right panel; peers as "from X"; notices as one line; Queued under the
  box with ✕; Stop beside Send; the minimap (`lib/minimap.ts`, T3's geometry, MIT).
- **Checked**: `services/host/test/chat-lab.mjs` (its own lab session; a replay of a real 3 MB session plus live Opus and
  Haiku hosts): **18 of 18**. Page: http://127.0.0.1:8891/card/agent-base-build-muql8y8r/html.
- Running hosts keep their old code until restarted; new hosts get all of it.

### Terminal agents in the app's chat, built 2 Oct (~13:45 +07, backlog 2a)

Every Claude agent gets the chat today, under siso-host or not. For an agent in the plain terminal, the node reads its
Claude session file (`services/node/src/transcript.ts`: found in any `~/.claude*` or `~/.config/claude*` folder;
read-only; fs.watch plus a 500 ms poll; the last 16 MB on open) into the same events siso-host sends, so the chat draws
both the same. Typing goes into the pane through herdr (`pane send-text`, several lines as one bracketed paste, then
Enter); Stop sends Escape; the state comes from herdr. The agent shows Chat | Terminal once its session file exists
(Claude Code writes it on the first message). Not here yet for terminal agents: live word-by-word streaming (the file
gets whole messages; the lead's reply lands when its last block is done), approvals (the terminal still asks), queued
and thinking (Claude Code stores thinking empty). **Checked**: `services/node/test/terminal-chat.mjs` with a real
`claude --model haiku` in a lab: 7 of 7 (typed in the chat, reply back in 1.3 s; a live 71 MB session reads in 56 ms).

## 7. Open items (not blocking phase 1)

- **"Needs you"**: herdr has `blocked`; a Claude hook (Notification / PermissionRequest) should run
  `herdr pane report-agent --source agent-base --agent claude --state blocked --message "<ask>" <pane>`. Not built.
- **Resize takeover**: an attached view resizes the agent's terminal for every viewer (test 1). Fine while the app is
  the only viewer; decide when Shaan uses herdr's own window alongside.
- **Design lab** (pick by looking): started then paused. Sucrase is built at `/private/tmp/claude-501/-Users-shaansisodia-SISO-Workspace-SISO-Agency-apps-siso-internal-labs-siso-internal-labs-agents/25dfb4b2-1f41-4375-90c9-3420290edf1b/scratchpad/sucrase-build/sucrase.mjs`
  (session scratch; rebuild with `npm i sucrase esbuild` + `esbuild --bundle --format=esm` if gone); the bank picks are verified real. Restart it only for decisions T3's pieces don't settle.
- **Pop-ups**: Shaan said Codex's pop-ups "work and don't work"; ask which, by voice, when he next looks.
- **New chat via Agent Zero**, routines, voice, phone, web, friends: later phases (INTENT.md, build order on screen ?).

## 8. Safety and house rules

- **Tests never attach to live agents.** Use the isolated lab: `…/2026-10-01-agent-app/tests/1-clean-terminal/lab`
  (wraps `siso-firstmate/bin/fm-herdr-lab.sh`, scrubs herdr identity). Reading the live `herdr agent list` is safe.
- Running now (2 Oct 00:30): lab session **`fm-lab-agentbase-66577-11616`** with three fake agents (alpha w1:p1
  working, charlie w1:p2 blocked, bravo w1:p3 idle; `fake-agent.sh` echoes lines), and the node on **:5402** pointed at
  it (`AB_HERDR="<tests/1-clean-terminal>/lab run fm-lab-agentbase-66577-11616"`, log at
  `/private/tmp/claude-501/-Users-shaansisodia-SISO-Workspace-SISO-Agency-apps-siso-internal-labs-siso-internal-labs-agents/25dfb4b2-1f41-4375-90c9-3420290edf1b/scratchpad/node-lab.log`). Tear down: stop that node process (match `AB_PORT=5402`/`src/server.ts` by pid), then
  `./lab teardown fm-lab-agentbase-66577-11616`.
- Never print secrets; Playwright and builds through `heavy --`; never open windows on Shaan's screen.
- His words are saved verbatim in `siso-internal-labs-agents/intent/` (append-only); the research folder's pages are
  rebuilt by their `build.py` and posted with `console-post`.
- Reply to Shaan in the `adhd-agent-output` / `shaan-report` shape: next action first, X of Y, ≤5 items, a URL.

## 9. Resume here

1. Read this file (§6 "Where phase 1 stands"), then `INTENT.md`, then screen 1 and ◐ of wireframes v0.6, then `packages/README.md`.
2. `pnpm install && pnpm build`; for tests start the node against the lab (§8), never live agents.
3. Option B is built (§6 "Option B"). Next: agents register themselves at spawn (the spawn tools call
   `POST /api/registry {op:"register"}`), then **the chat view** as the SDK host in a herdr pane (§2). His call at 01:45: **the chat view** ("look at how T3 code does the chat and swap the cli chat to the the ui
   one so we actually own the nicer ui which shows our real clawed shit and maybe it still works with clawed commands").
   Start from `…/2026-10-01-agent-app/tests/2-chat-view/` (the session-file chat view, 900 lines) and T3 Code's
   `apps/web/src/components/chat/*`; keep the terminal one click away. Then sub-agents and outputs in the summary card,
   the Needs-you hook (§7), the org chart. New good parts go into `packages/`.
