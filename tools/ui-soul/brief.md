# {{NAME}}: {{TITLE}} (UI soul · task {{TASK}})

Shaan's words: {{WORDS}}

What to do: {{ASK}}

Worktree: this one (branch {{BRANCH}}). Commit here. Do NOT push and never touch dev or main.


## 0. Never block: it's code work, finish it (Shaan, 5 Oct 05:40: "they shouldn't get blocked, they should just be able to be one shot and sorted out ... nothing blocks them building code")
- The spec is your starting point, not a cage. If it is thin, wrong, or names the wrong file (it happens), read the code,
  make the smallest sensible call that keeps its intent, write the call and why in REASONING.md under "Calls I made", and keep building.
- A "don't touch X" in the spec means "don't redesign X". A pure move or a small hook in X that the build needs is fine; say so in REASONING.md.
- Failing screenshots, a flaky test you didn't cause, a missing fixture: work around them, note them, carry on.
- The only reasons to stop: it would delete or rewrite his data, touch a live agent, push to main or dev, or need a secret.
  Anything else, decide and build. Ending without a commit is a failure, not a safe choice.

## 1. Reason first: this is most of the job (Shaan 4 Oct: "spend more tokens ... two three times ... go deeper on each pass")
Before you touch any code, write `ui-hub/{{COMP}}/rounds/{{SLUG}}/REASONING.md`. Spend real thought here. Shaan's complaint
about souls is that they "don't spend enough time reasoning what to add ... a bit lazy ... how it fits in". Cover each of these:
1. **What it is FOR**, in his words (quote them). In one line, what changes for him when it's done.
2. **Three concrete moments** he uses it: who, when, what he's looking for, and what he does next. Use real cases from
   this app: Agent Zero, the owners, Codex souls, a phone at night.
3. **What already exists.** Read `ui-hub/{{COMP}}/README.md`, its FEEDBACK and REASONING files, and the components
   next to it. List what you will reuse; never build a second copy of a part the app already has.
4. **Three options** with what each costs and what each gives. Pick one and say why. Say what you are deliberately NOT
   adding: keep it use-case specific and don't overcomplicate it.
5. **Fit:** how it sits next to its neighbours at 1440, 1024 and 390 wide, with the side nav and the panel open and
   closed. Say what moves.
6. **The extra that makes it good:** one or two details that serve the moments in 2, not decoration.
His standing nos: no queuing UI, no warning dots, no next-move chips, no collision warnings, no permission-ask
designs. Keep the input bar's glow exactly. The sub-agents pill and popup are his: refine only.

## 2. Build it
Match the surrounding code and CSS: the same tokens, spacing and quiet look. Reuse the parts you listed in 1.3.

## 3. Before and after (the deliverable)
**Only when the look changes.** A fix with no visible change (data, wiring, a server bug) needs no shots: prove it with code,
a test or an HTTP check instead (Shaan, 5 Oct: "doesn't always need to take screenshots, sometimes just looking at the code is
enough"). Screenshots never stop the job: if a capture fails after one retry, note it in REASONING.md and carry on building.
Shoot 1440 and 1024; shoot 390 only when the change touches the phone layout.
- Build the web app (`cd apps/web && heavy -- pnpm build`), then serve the fixture:
  `COMPOSER_SERVE=working COMPOSER_PORT={{PORT}} node tools/composer-shots.mjs after-ui`. When the shots need data,
  seed it, for example `AB_A0_TASKS=<dir>` for tasks. Stop every server you start, by its PID.
- Take screenshots with headless Playwright WebKit (resolve `playwright` from services/node), at @2x, at the
  viewports from 1.5. Shoot BEFORE you edit and AFTER you finish.
- Save them as `ui-hub/{{COMP}}/rounds/{{SLUG}}/NN-before-<what>-<w>.png` and `NN-after-...`. Add a gallery page
  to `ui-hub/components.json` under `{{COMP}}`:
  `{"id":"{{SLUG}}","title":"{{TITLE}}","kind":"gallery","file":"rounds/{{SLUG}}/"}`.

## 4. Critique your own after shots, then make one more pass
Look at your AFTER images against REASONING.md: the moments, the fit, the details. Write what is still weak at the
bottom of REASONING.md. Fix the worst thing, then reshoot.

## Rules
- Light checks only: `cd apps/web && heavy -- npx tsc --noEmit -p .` and the build. Do not run `pnpm check` or
  ui-round.
- Everything runs headless through `heavy --`. No windows on Shaan's screen.
- Never attach to live agents: 127.0.0.1:5401 is live, so read-only GETs at most.
- When done, move your task on the board:
  `~/SISO_Workspace/SISO_Agents/agent-zero/siso-agent-zero/bin/a0-task move {{TASK}} built --evidence "<sha> + shots" --by {{NAME}}`

## Report
End with: DONE <sha> + the gallery page + 3 lines on what you chose and why (including any "Calls I made"). BLOCKED only for the four reasons in step 0.
