# Agent Base: what the bar is for, and what we're missing

UI seat, 4 Oct 2026. Reasoning only, with no pictures: Shaan, ~07:00, "no feedback just pure reasoning ... what are the cool things
are we missing how does it fit into the wider picture ... not just features but actual like use case shits".
Every section ends with a decision, so whoever builds it doesn't have to work it out again.

---

## 1. The wider picture

Agent Base is one window onto every agent herdr runs, with Agent Zero pinned on top. Shaan doesn't write code in it. He **directs a
fleet**: he talks (more than he types), he hands work out, he checks it, and he says yes or no. Two things run short, in this order:

1. **His attention.** He has ADHD-shaped focus; anything that makes him look in a second place, read a wall of text, or remember
   state costs more than any token. His own rules: the first line is the next action, give a URL not prose, five items or fewer.
2. **The limits.** The 5-hour and weekly Claude limits, the Codex credits and the context window. The week ran to 87% on
   the Monday of this work. When a limit runs out, the work stops.

So every feature has to **save attention or save limits**. If it does neither, it's decoration, and he calls that "lazy".

The input bar is where his attention already is: it's the one place he looks every time he speaks. So it's where the
fleet should come to *him*, instead of him going to the fleet. That's the thread through everything below: **the bar is the
fleet's front desk, not just a text box.**

## 2. Use cases: a real day, and what the bar must do in each

| Moment | What he's doing | What the bar must do |
|---|---|---|
| **Morning, coffee** | "What happened overnight? Ship the input bar, start the side nav." | Let him speak without typing (voice in the rim); read the answer's first line aloud only; offer the likely next asks as chips. |
| **Fan-out** | Agent Zero sends five Codex workers out on one job | Show them as named, described tiles grouped by the job (§3–4), each with a live tok/s; a finish pops out with what it cost and what it made. |
| **Something is stuck** | One worker has gone quiet | The stuck one looks stuck (a sleeping face) without him opening anything; one tap opens its transcript in the split page; he can say something to *that* worker (§7B). |
| **A worker needs him** | A permission or a question | It raises its hand on the bar with the answers right there. He answers on the bar and never switches chat. |
| **Limits are tight** | Week at 87% on a Monday | The model picker becomes a budget choice: who should do this, at what effort, and what that does to his week (§6). |
| **Context is full** | Agent Zero at 84% | The ring is amber; Compact writes the handoff first, then compacts (§7C), so nothing is lost. |
| **Reviewing design** | The UI seat has a round ready | The round lands as an artifact chip above the bar ("Input bar r5 ↗") instead of a URL buried in a reply (§7A). |
| **On his phone** | Away from the laptop | The bar is a remote control: voice, approve, see who finished. The orb must not cover the pill at 390. |

## 3. The agents popup, made cleaner: a mini org chart

**His words:** "make the agent pop up even cleaner ... mildly better", and earlier "the exact component that we had before ... I don't want a remake".
So: keep it the same thing (the pill, the faces, the popup it opens) and clean up how it reads.

**What's noisy now:**
- Three grammars side by side: Claude sub-agents are list rows with a three-line stats column, shells are rows with a Stop button,
  and Codex batches are org-chart cards (round 4). Your eye has to change mode three times.
- The header is a sentence: "5 running · 0 done today · 501 tokens".
- "Agent Zero · main chat · you're here" takes a whole row to say where you already are.
- "Done today" is a long list under "Running" that pushes the live work off screen.

**The design: the popup is a small org chart, read top to bottom, with one tile grammar.**
1. **Header, one line:** the agent's face, its name, then `5 working · 48 tok/s · $1.20 today` (the numbers in the pill, plus cost). No sentence.
2. **No "you're here" row.** The header *is* the main chat; clicking the face or name goes back to it.
3. **One group per spawn**, drawn like the org chart's project card: an accent on the top edge, the job's title and "2 of 5 done", the
   segmented bar, then the tiles. A Claude sub-agent spawned on its own is a group of one, with no card chrome around it, just the tile.
4. **One tile, used everywhere** (the AgentNode shape): face · the model in small caps · the **name** · the **description** in one line ·
   `2m 4s · 35 tok/s`. Running tiles have a cyan dot; a finished tile turns green and slides to the end of its group. A stuck tile
   (no output for 2 min) shows the sleeping face and the dot dims.
5. **Shells are chips, not tiles:** a footer row `▸ build output  ■` `▸ dev server  ■`, where ■ stops it. They aren't agents, so they
   shouldn't look like agents.
6. **Done today shrinks to one line of faces:** "✓ 6 done today" followed by the six faces overlapping (the pill's stacking, which he
   likes). Tap to expand them as tiles.
7. **Clicking any tile opens that agent in the split page** (§4). Hovering a tile shows its last two lines of output, so you can
   peek without opening.

Decision: build exactly this. Keep `SubagentsPopover` as the component (same trigger, same portal, same keyboard handling);
replace the row rendering with the tile, and the groups with the card. `SubagentRow` keeps serving the right panel unchanged.

## 4. Named sub-agents that open in the split page

**His words:** "the agent spawning the agents should be able to set them as nice names with descriptions ... click on them and it
opens up the split page that we already have. And you can see those sub agents in this CLI or SDK or whatever is available."

**Names and descriptions come from the spawner, by convention, with a fallback:**
- **Claude sub-agents (Agent tool):** the Agent call's `description` is the slot. Convention: `NAME: what it is doing`, for example
  `SPEC-HEADER: drafting the header spec`. The node already reads a `.meta.json` per sub-agent (name, model, toolUseId, agentType,
  description). Parse the `NAME:` prefix into `name` and the rest into `description`. Teach the convention in the harness brain
  (CLAUDE.md / the `subagents` skill), so every spawner names its children the same way.
- **Codex workers (`codex-run`):** meta already has `name`, `worker` and `batch`. Add `--about "<one line>"` and write it to meta
  as `description`; `batch` stays the group title.
- **Fallback when the spawner gives nothing:** `subagent_type` in caps plus the first five words of the prompt. Never show a uuid.
- **Show both everywhere:** tile, popup, finish pop, the right panel, the org chart. The name is the identity; the description is the "doing".

**Clicking opens the split page.** One rule for every kind: the main chat stays on the left and the sub-agent's live transcript opens
on the right, rendered with the shared chat transcript components (already used for Builder runs, b8e83e9).
- Claude sub-agent → its sidechain (the `subagents/agent-*.jsonl` file for that toolUseId).
- SDK seat's sub-agent → the same file, under that seat's session.
- Codex worker → its `runs/<id>.jsonl`, rendered the same way, with commands and file changes as tool rows.
- A crew agent (a herdr pane) → its own chat or terminal, as now.

Decision: one `openSubagent(row)` → `split(row)` path; the renderer picks the file by kind. The popup, the finish pop, the fan-out
lines in the chat and the org chart all call it.

## 5. Drag to make the bar taller

**His words:** "you should be able to drag to make the hud taller the chat taller if you want to".

- **A grab line on the rim's top edge** (it shows on hover, a 2px pill like a sheet handle). Dragging up grows the input area, and
  the HUD row stays pinned to the bottom of the rim.
- **The two-line cap becomes the default, not the maximum.** Dragged taller, the input holds what you set, up to 60% of the window. Below 2 lines it snaps back.
- **Remembered per chat** (Agent Zero's chat may want a tall writing box; a worker's chat stays small). Double-click the handle to reset.
- **Keyboard:** ⌘⇧↑ / ⌘⇧↓ step it up or down by two lines.
- **The glow is untouched**: it follows the rim's size as it already does.
- **Writing mode:** dragged past half the window, the bar becomes a focused editor (wider line length, the transcript dims). This is for
  long specs, where he would otherwise write somewhere else and paste.

Decision: build it in the composer (`ChatView` sets the textarea height from a stored value instead of the two-line cap; the
handle lives in `Composer.css`). `--ab-composer-h` already tells the transcript how much room to leave.

## 6. The model picker, rebuilt: who should do this, and how hard

**His words:** "the model selector for opus should be way nicer maybe showing efforts ... visually way nicer ... it needs to actually
have the actual agent faces".

**What's wrong now:** a plain list. Every row shows the *same* "Claude" face. The effort row is hidden for SDK seats, so Agent Zero,
his main chat, never sees it. Nothing tells him what a choice costs.

**The design: a cast, not a list.**
1. **Faces across the top, one per model, each its own character** (halo-face, by name): Opus, Sonnet, Haiku | Sol, Luna. The current one is
   awake and glowing, the others are dimmed. The same face means the same model everywhere in the app: the model chip, the faces
   pill, the popup tiles, the org chart. That's how "the actual agent faces" become meaningful: you learn the cast.
2. **Under the faces, the chosen one's card:** name and window ("Opus 5.5 · 1M"), what it's good at (one line), and three small
   bars (**speed**, **depth** and **cost**) on the same scale for every model, so moving between faces shows the trade at a glance.
3. **What it does to your limits:** "≈ 3% of your week per hour at this chat's pace", computed from this chat's tokens/hour and the
   model's prices. When the week is hot, this line is amber. This is what turns the picker into a budget decision.
4. **Effort as a 4-step control: low · medium · high · max.** Each step changes the face's look (eyes from relaxed to focused,
   brighter at max), so effort *looks* like effort. It works for SDK seats too: the seat takes an effort setting next to set_model.
   Today `ModelMenu` only offers `/effort` typed into terminal Claudes.
5. **Moving to another harness is the last line:** "Move this chat to Codex (Sol 6.1) →". It's there, but quiet.
6. **Keys:** 1–5 pick a face, ←/→ change effort, Enter applies.

Decision: build it in `ModelMenu` with `AgentFace` per model name (not "Claude" for all); add an effort message to the SDK seat
protocol; the limits line reads the same data as the 5h · wk card.

## 7. What we're missing: the bigger ideas

These are new abilities, not tweaks (round 1 got "really lazy").

**A. The artifacts shelf.** Agents make things: a URL, a page, a PR, a screenshot, a spec. Today these hide inside replies, and his
rule "give him a URL, never a wall of text" depends on each agent remembering. Instead, anything an agent produces lands as a chip
just above the bar: `Input bar r5 ↗` `PR #212 ↗` `side-nav spec ↗`. Chips last for the session; click to open; × to clear. One
way to post them (the console-post contract, aimed at the chat). *Saves attention.* **This is the most important one.**

**B. Talk to one worker with @.** Type or say `@CODEX-2 also check 390` and the message goes to that worker, not the main chat.
Codex workers can take it on their next run (resume with the message); Claude sub-agents can't be interrupted mid-run, so the
parent gets it as "tell CODEX-2: ...". The faces pill offers names as you type @. This is how you steer a fleet without opening five tabs.

**C. Compact that writes the handoff first.** His rule is "compact at a clean break after writing HANDOFF.md". The Compact button
should do exactly that: ask the agent to write the handoff, wait for it, then /compact. It's what he'd do by hand, in one tap.
*Saves limits and loses nothing.*

**D. Collision warning.** Many agents work across the estate's worktrees. When another live agent is editing the same files or
branch as this chat, a quiet line says so: "AGENT-BASE is also editing Hud.tsx". herdr knows each pane's cwd, and the node
can see their git status. It catches the "two agents fought over one file" mistake before it happens.

**E. A finish pop that says what it got for the money.** "CODEX-2 done ✓ · $0.42 · 3 files · 1 test added". Over weeks this teaches
him which models are worth which jobs, and it feeds the model picker's "good at" line with real numbers.

**F. The bar as a phone remote.** At 390 the bar is the whole app: voice in the rim, raised hands answered with a tap, finish pops, and the
agents popup as a full-height sheet. First fix: Agent Zero's floating orb covers the right end of the bar (the open thread in the
input bar README).

**G. The chat's timeline on the ctx ring.** The context card gains a strip of your turns, with a face at every spawn and a tick at every
finish. Tap a turn to fork a new chat from there (round 2 idea 7). The ring becomes the chat's history as well as its fuel gauge.

## 8. Order to build, by what it saves

1. §3 the popup as a mini org chart, and §4 named sub-agents opening in the split page (he asked for both directly; they share the tile).
2. §6 the model picker with faces and effort (asked directly; the effort for SDK seats is the missing piece).
3. §5 drag to resize (asked directly; small).
4. §7A the artifacts shelf (biggest attention saver), then 7C (handoff-compact), then 7B (@ a worker).
5. The rest after he picks.

Each of these changes code he will see, so each ships the way the hub says: built on `ui/opus`, `pnpm check`, then his yes. He's asked
for no more screenshots for now, so check with assertions in `tools/composer-shots.mjs` (counts, text, states) rather than pictures,
and save pictures for when he asks to look.
