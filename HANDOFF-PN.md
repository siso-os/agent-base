# PROJECTS-NAV handoff (3 Oct, opus/nav-0005)
- Branch tip: see `git log -1 opus/nav-0005` (this file's commit, on 9e25f94). Worktree: _data/worktrees/siso-internal-labs-agent-base/projects-nav.
- Done + tested (laptop, heavy): 6b53d56 five page icons above A0, HALO's Streaming/CRM, Maths Innovations, Family's Property + Trading for Dad (dormant); 8646385 top bar pages removed, pinned rows → A0 face strip with the row hover card; 904a48d merge of integration/ship-a638254.
- Project pages v2: f29cdcf (build) + 9e25f94 (fixes) are now TESTED, not just written: pnpm -s check 0, org.mjs, entity-page-ui 12/12, projects-nav-ui 20/20, sidenav-d 16/16, sidenav-r12 14/14, nav-ui 5/5, faces-ui 7/7, t0008-ui 10/10.
- Files: services/node/src/pages.ts (assembler), server.ts (/api/org/project page, /api/org/thumb), org.ts (industry:<slug>, folder, template, clients), apps/web/src/components/EntityPage.tsx/.css, OrgPage.tsx.
- Next (spec specs/2026-10-02-project-pages/SPEC.md): INDUSTRIES.json + CLIENTS.json `industry`/`money`; Plane counts; repo visibility; Foundry research; A0's Opus visual pass.
- Commands: `heavy -- pnpm -s build`, `heavy -- pnpm -s check`, `heavy -- node services/node/test/<check>.mjs`, `node --experimental-strip-types services/node/test/org.mjs`.
- Known reds: header-ui 25/26 (Agent Zero header line 2, before t-0008); sidenav-d hover-card check flakes on the laptop (also on a09934b).
- Port flake: fixed ports (5437 r12, 5446 projects-nav-ui) collide with other lanes; `lsof -iTCP:<port>` before trusting a red.
- Open for A0: who writes CLIENTS.json stage/industry/money; Start on a seat is SDK-START's; project pages never read personal/.
