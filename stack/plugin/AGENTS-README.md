# Claude Code Agents

Six Haiku 5.5 sub-agents (effort high, compact at 100k) every Opus seat can call, plus the Opus roles:

| Agent | Purpose |
|-------|---------|
| **scout** | Answers one precise question about code, files or docs, with file:line. Use instead of 3+ reads or searches. |
| **runner** | Runs builds, tests, linters, scripts and long commands; returns PASS or the failures. |
| **checker** | Verifies one claim against evidence (a diff, file, or command output); returns a verdict. |
| **editor** | Makes a mechanical edit to an exact spec and returns the diff. |
| **librarian** | Where something lives or what was decided across the estate (estate where, HANDOFFs, memory). |
| **researcher** | One question from the web or official docs, a URL for every claim. |
| specker, worker, reviewer | Opus roles: spec, build, review. |

**Rule:** Opus decides; fetching goes to scout or librarian, the web to researcher, running to runner, typing to
editor, verifying to checker. Independent questions go to several agents in one message so Opus wakes once.
Haiku 5.5 is about 40x cheaper per token than Opus 5.5 ($0.10/$0.50 vs $4/$20 per M). Give each a precise question
or spec; Haiku needs more detail than Opus.
