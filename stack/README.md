# stack: the SISO agent stack, loaded by every launcher

`plugin/` is a Claude Code plugin (`--plugin-dir stack/plugin`). Its agents are the roles an owner spawns with the `Agent`
tool instead of opening herdr tabs: `siso:worker` (builds one task), `siso:specker` (writes the spec), `siso:reviewer`
(independent check). Each preloads only its own skills and has no Skill tool, so it sees nothing else.

Spawn one as a named background worker, so it can be messaged and resumed later:
`Agent({subagent_type: "siso:worker", name: "w-<task>", run_in_background: true, prompt: "<brief>"})`.
The worker's transcript and `.meta.json` land in `<projects>/<owner session>/subagents/`, which the app already reads
(`services/node/src/subagents.ts`).

Plan and evidence: `SISO_Agents/siso-harness-lab/.agents/plans/2026-10-02-native-agents.md` (steps 2-3). Skills, hooks and
settings move in here at step 4 (one config home).
