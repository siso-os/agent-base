# An agent team that works: split by context (design, 5 Oct 2026)

Shaan, 5 Oct ~01:25: "instead of having agents, we have agent spaces ... a worker codex soul integrating ... a persistent member of the
team ... split pane ... scroll across, zoom in zoom out". ~01:45: "the name of the game is context ... a lot of the wastage in the systems
comes from wasted context of having to relearn stuff. That's why I think sometimes one agent works better, but like if you do the split well".

## The data (2-5 Oct)
- **Souls:** 169 outcomes: 114 done, 24 blocked (14%), 31 with no status.
  - Blocked by:
    - their scope edge: 6;
    - missing fixture data: 5;
    - a shared checkout: 5;
    - machine or gate problems: 5;
    - a contradictory brief: 2;
    - another writer's break: 1.
  - ~70% of commands came before the first edit (orientation). 97% of input tokens were cached, so the cost is time (median 10 min, up to 48), not money.
- **Ship queue:** 87 live, 20 conflicts (15%), 10 superseded.
  - Eight seats ship Agent Base: A0, AGENT-BASE, UI, AGENT BASE UI, BROWSER, NAV-2, RELEASE-1, EFFICIENCY.
  - On 4-5 Oct every failure was at landing, not building.
- **Board:** 238 Agent Base tasks: 132 live, 52 dropped. 32 went live within 3 minutes of creation (logged after the fact).
- **Agent Zero PRINCIPLES (4 Oct 00:08):** "no owners, seats", "one writer per codebase", "a model is started for a job and ends with it", "fresh context per job". On 4 Oct 23:20 Shaan made a persistent owner. Both sides show costs: fresh-per-job dies on questions and relearns; many seats means many shippers and conflicts.

## Four kinds of context
| Context | Cost to rebuild | Lives in |
|---|---|---|
| Intent (his taste, standing rules, why) | highest; tacit, relays lose it | the **owner**, persistent |
| Code (where things are, conventions, traps) | high; the 70% orientation | a **line** per active component, plus its dossier in `ui-hub/<comp>/` |
| Landing (runner quirks, flaky tests, merge traps) | medium; one agent needs it | the **integrator**, persistent, plus `LANDING.md` |
| State (in flight, live, queue) | zero; computed | board, queue, git; never in a head |

**Rule:** split only where what crosses the boundary is smaller than what sits on either side.
- Owner→line crosses a spec plus his words.
- Line→integrator crosses a branch plus checks.
- Work that cuts across many files goes to one line whole.

## The team
1. **Owner** (one per space): talks to Shaan, specs, taste-checks shots. Writes no code, never ships.
2. **Lines** (one per active component):
   - rounds on a component resume the same Codex thread;
   - each has its own worktree;
   - keeps its dossier current;
   - asks at its scope edge instead of dying;
   - closes when the component is done.
3. **Integrator** (one per codebase): the only writer of dev. Merges, checks a clean tree, ships, confirms live, fixes flakes.
4. **Breadth helpers**: fresh, read-only (research, review, screenshots). The only fresh-per-job agents.

**Bus = the board** (level-triggered, no agent-to-agent pings):
- owner → line's queue (`agent=<line>`);
- the line's question → "needs" on the task; the answer is delivered at its next step;
- built + branch → the integrator's queue.

**Concurrency:** landing is serial (about one or two ships an hour), so 3-4 active lines at most.

## How it shows
1. **Side nav:** space cube → owner → lines (working / waiting for review / question) → integrator with its queue count.
2. **Click a line:** the chat splits, owner left and line right, with the round's before/after in the line's header.
3. **Zoom out:** all lines, then all spaces (the dashboard).

## Measures
- Commands before first edit: 70% → under 30%.
- Blocked: 14% → about 5%.
- Ship conflicts: 15% → about 0.

## Build order
1. Integrator seat plus LANDING.md, sole shipper of Agent Base.
2. Component dossiers plus thread resume.
3. "Needs" state plus next-step delivery.
4. Side nav rows, split chat, zoom.

**Open, for Shaan and Agent Zero:** amend PRINCIPLES #2 and #7 to "persistent only where context is expensive to rebuild: intent, active component, landing". Not edited by this seat.

## Revision after Musk's algorithm (5 Oct ~02:00; Shaan: "save agents chats based on components ... what would Elon Musk do")
- **Requirement, made less dumb:** "no relearning, and I can steer the work while it happens", not "persistent agents".
- **Delete the saved chat as memory.**
  - It is a stale copy of the code: 17 source files changed on dev between 23:45 and 01:00 on 4-5 Oct.
  - Re-reading is cheap (97% cached); searching is what costs.
  - Memory = the component file in `ui-hub/<comp>/`: files, traps, reasoning, feedback. Every job ends by updating it, and a check enforces that.
- **Delete the integrator agent.** The queue ships alone and takes only clean, rebased, checked branches; it refuses a dirty tree. A conflict goes back to the job that wrote the branch, which has the context.
- **Delete persistent lines.** Builders are fresh per job and start from the component file.
- **Keep:**
  - one persistent owner per space (intent cannot be written down cheaply);
  - paused jobs: a builder at a question pauses, its chat is saved under the component name, and the answer resumes it (hours, not days).
- **Test before deciding further:** run the same dashboard redo as (a) a resume of DASH's chat vs (b) a fresh agent plus a good component file. Compare commands before first edit, the checks, and the shots.
- **Build order now:**
  1. the queue refuses unclean or unchecked work and bounces conflicts to the author;
  2. component files plus the end-of-job update check;
  3. pause and resume on questions;
  4. the A/B test;
  5. side nav component states plus split chat.

## The Agent Base space screen (5 Oct ~02:30; Shaan, with a screenshot: "how does the agent base space feel like what actually supposed to be here")
- **Today:** the same jobs appear in four places (side nav "1 working", Tasks "0 open" (wrong), Sub-agents subtitled "RETURN", Timeline pipeline). The Agent Base cube shows "+ New owner" while its owner runs elsewhere as "SISO Interna...". Suggested-reply chips are still there.
- **Should be:**
  - **Left:** cube → owner → active component jobs (⏸ question / ◐ building / ✓ review), numbers only.
  - **Middle:** the owner chat; click a job and it splits, with the job's before/after on top and its question as a normal message at the bottom (no approve/deny UI).
  - **Right:** Needs you, then Building (task + face; replaces Tasks + Sub-agents), then Timeline, then Stats folded.
- **First step:** a fixture mock-up as one hub URL before building.

## Correction: the space is a product map, not an agent status board (5 Oct ~02:45)
Shaan: "it's not does anything need me, that's like a bottleneck ... what's running, what needs to be worked on, what can I next/later,
what can I allocate, what more context and feedback can I give ... what pages have I worked on, what pages have I not ... what's rated
good, what's rated shitly".

**Data (board, by surface):**
- Most attention: chat 41, Agent Zero 30, Tasks 22, right panel 17, Fleet 17, side nav 16.
- Least: header 1, Ended 3, Timeline 4, Servers 5, phone 6.
- About ten of the 22 page files have had almost no work: Library, Life, Rolodex, Research, Starred, Laptop Jobs, Codex Work, WhatsApp, Entity, Dictation.
- **Zero ratings are stored anywhere.** Only 2 hub feedback files exist (chat-header, input-bar); the rest is scattered across task fields, READMEs and chats.
- The system keeps machine checks and drops his value checks, so builders relearn his taste every time.
- Seed: A0's page inventory (jobs/ab-page-inventory, 3 Oct) has 32 full-page shots.

**Design:**
- Every surface (pages + shared parts, about 30) is a tile with:
  - the latest live screenshot (nightly capture);
  - his rating (good/ok/shit + date);
  - open feedback count, rounds, last worked;
  - the running builder's face.
- Lenses: Shit first, Never reviewed, Running now, Landed this week, Now/Next/Later lanes.
- A surface page holds:
  - the big shot with voice feedback pinned to it (point at a region);
  - feedback verbatim (open/addressed);
  - before/after history, tasks;
  - Allocate (the owner drafts the spec from open feedback).
- Storage = the component file: `ui-hub/<surface>/surface.json` (rating) + FEEDBACK.md; tasks link `links.surface`. Good-rated surfaces are references in builder briefs.

**First step:** re-capture the shots, then a 5-minute rating pass by Shaan (30 tiles, good/ok/shit + optional voice note).

## The standing cast per space (5 Oct ~03:15; Shaan: "what other agents should we have persistent on this fleet which doesn't have context clashes ... which actually adds roi")
Tests for a seat: its own context, its own write place, recurring work, measurable output.
- **Orchestrator:** intent; writes the board and specs.
- **Builders (1-3, by area):** chat / side nav + pages / right panel / node + data; each writes only its branch.
- **QA walker (Mac mini, after every ship):** walks every surface headless against the product map; files bugs with shots.
  - Tonight Shaan found every bug: Tasks 0 open, RETURN rows, Connecting forever, the "11", token numbers.
- **Researcher:** outside context (apps, banks, ui-pick, Great Library); writes notes and pins.
- **Not seats:** integrator (the strict queue does it; revisit if conflicts > 10%), reviewer (taste stays with the orchestrator).
- **Clashes come from shared files** (3 days): server.ts 2871 lines / 149 commits, App.tsx 2007 / 129, ChatView 72, Sidebar 1256 / 68,
  plus components.json in every round. Fix: split server.ts into route files per area and components.json per component.
- **Space layout:** orchestrator centre, builders right, QA below, researcher left, pins top.

## Navigation, from first principles (5 Oct ~05:00): Arc-style project spaces
Shaan: "i don't actually like this space because it doesn't show the chats properly, i zoom out and it turns into a different view ... maybe
agent base gets its own card like agent zero with its own agents ... its own nicer dashboard".
- **The primary object is a chat;** the rest is context. A zoom canvas swaps the chat for another view at every zoom, so it is the wrong
  shape for chat-centred work.
- **Model = Arc's Spaces:**
  - Home space = Agent Zero, unchanged.
  - Each pinned project is a space (Agent Base, HALO) with its own accent and side nav. Switch by the space icons at the bottom of the nav, a two-finger swipe on the nav, or ⌘1-9.
- **Agent Base space side nav:**
  - an owner card like Agent Zero's (face, state, "N to rate");
  - its crew row (souls and sub-agents, live ones ringed, + spawn);
  - pages: project dashboard (crew, moving, landed to rate, product map), Timeline, hub;
  - earlier souls folded.
- **Main:** one readable chat. Click a crew face to open it; ⌥-click opens it beside (split). Each space remembers its last chat.
- **Right panel:** the focused agent's context. The nav is who and where; the panel is what.
- **The canvas:** stops being navigation. The builder frame becomes the soul view, and the overview becomes the project dashboard.
