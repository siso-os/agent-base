import { createElement } from "../apps/web/node_modules/react";
import { createRoot } from "../apps/web/node_modules/react-dom/client";
import { ProjectDashboard, type HubProject, type DashboardAgent } from "../apps/web/src/components/ProjectDashboard";
import "../apps/web/src/index.css";
// Snapshot from hub-design/data.json (2 Oct, 15:18). Health uses the same handoff observations as build.py.
const project: HubProject = {
  "id": "halo",
  "name": "HALO",
  "group": "agency",
  "line": "Cam Kellman’s creator agency. Three owners, 9 agents.",
  "accent": "var(--accent-tasks)",
  "icon": "chess-king",
  "owners": [
    {
      "name": "STREAMING-CLAUDE",
      "kind": "owner",
      "project": "HALO",
      "domain": "Oracle go-live: the Mac app, the server path, every platform, the proofs, the production release",
      "role": "Go-live",
      "icon": "radio-tower",
      "accent": "var(--accent-tasks)",
      "harness": "claude",
      "model": "Opus 5.5",
      "machine": "laptop",
      "state": "done",
      "spunUp": true,
      "plan": {
        "checked": 6,
        "total": 26,
        "counts": {
          "asked": 3,
          "specced": 4,
          "allocated": 4,
          "building": 2,
          "built": 6,
          "checked": 6,
          "parked": 0,
          "dropped": 1
        }
      },
      "workers": {
        "total": 3,
        "working": 0
      },
      "lastReport": {
        "at": "2026-10-02 14:31",
        "ageMin": 0,
        "text": "plan file created, 24 items, soak sgl-001 running · .agents/plan/streaming-go-live.json",
        "log": "owners.log"
      }
    },
    {
      "name": "OPS-BUILD",
      "kind": "owner",
      "project": "HALO",
      "domain": "Oracle Operator / Ops Hub: the board, onboarding a model, her workspace, Offboard, how it looks",
      "role": "Operator",
      "icon": "gauge",
      "accent": "var(--accent-tasks)",
      "harness": "claude",
      "model": "Opus 5.5",
      "machine": "laptop",
      "state": "idle",
      "spunUp": true,
      "plan": {
        "checked": 6,
        "total": 17,
        "counts": {
          "asked": 0,
          "specced": 3,
          "allocated": 2,
          "building": 3,
          "built": 3,
          "checked": 6,
          "parked": 0,
          "dropped": 0
        }
      },
      "workers": {
        "total": 2,
        "working": 0
      },
      "lastReport": {
        "at": "2026-10-02 14:31",
        "ageMin": 0,
        "text": "plan file created (17 items, 6 checked) · .agents/plan/operator.json",
        "log": "owners.log"
      }
    },
    {
      "name": "HALO-UI",
      "kind": "owner",
      "project": "HALO",
      "domain": "HALO CRM UI from the running app (HALO-UI lane)",
      "role": "CRM",
      "icon": "layout-dashboard",
      "accent": "var(--accent-tasks)",
      "harness": "claude",
      "model": "Opus 5.5",
      "machine": "laptop",
      "state": "done",
      "spunUp": true,
      "plan": {
        "checked": 10,
        "total": 19,
        "counts": {
          "asked": 3,
          "specced": 2,
          "allocated": 2,
          "building": 0,
          "built": 2,
          "checked": 10,
          "parked": 0,
          "dropped": 0
        }
      },
      "workers": {
        "total": 1,
        "working": 0
      },
      "lastReport": {
        "at": "2026-10-02 15:04",
        "ageMin": 0,
        "text": "plan on paper: partners/halo/.agents/plan/HALO-UI.json (PLAN-FORMAT.md; 19 asks: 10 checked, 2 built (#82, #101 waiting on Shaan/DEV), 2 specced (ship after his look; sisodev after 19:51), 2 allocated (bell board side OP",
        "log": "inbox.log"
      }
    }
  ],
  "counts": {
    "asked": 6,
    "specced": 9,
    "allocated": 8,
    "building": 5,
    "built": 11,
    "checked": 22,
    "parked": 0,
    "dropped": 1
  },
  "open": [
    {
      "id": "sgl-006",
      "title": "Step 7: End during Start wins (nothing for that run starts or pushes after an accepted End)",
      "status": "built",
      "to": {
        "agent": "STREAM-A"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-010",
      "title": "Stripchat sign-in: Turnstile host is IPv6-only, DEV proxy resolves IPv4 only (fix A, AAAA fallback, Stripchat login route only)",
      "status": "built",
      "to": {
        "agent": "STREAM-B"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-012",
      "title": "Stage camera preview shows her camera (was error)",
      "status": "built",
      "to": {
        "agent": "LIVE-FP"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-014",
      "title": "S1 Connect this Mac: oracle-dev:// link redeems her invite",
      "status": "built",
      "to": {
        "agent": "STREAMING-CLAUDE"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-019",
      "title": "S2 her sign-in window (live view of one login page, her own input)",
      "status": "built",
      "to": {
        "agent": "STREAM-B"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-020",
      "title": "chat_send reply box (stub, always off until a signed-in page can send)",
      "status": "built",
      "to": {
        "agent": "STREAM-A"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-001",
      "title": "Production gate: one Operator press held live 6 h on DEV with every platform that passed its first press",
      "status": "building",
      "to": {
        "agent": "STREAMING-CLAUDE"
      },
      "his": "Can we try and go live, please? Do whatever we need to do.",
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-011",
      "title": "AUTO-VIEWER: one natural chat + one 1-token tip reach Oracle exactly once, per platform",
      "status": "building",
      "to": {
        "agent": "AUTO-VIEWER"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-005",
      "title": "Board Stop command reads failed although the stream went dark",
      "status": "allocated",
      "to": {
        "agent": "STREAM-A"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-007",
      "title": "App orphan recovery clears a killed app's stale exact-run scope when the server holds no such run",
      "status": "allocated",
      "to": {
        "agent": "STREAM-A"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-021",
      "title": "Registration and dead-man over HTTPS without the mesh",
      "status": "allocated",
      "to": {
        "agent": "STREAM-A"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-026",
      "title": "CamSoda public-truth probe cadence: 30-60 s idle, ~15 s while a run is live (today ~6 s, a new renderer each read)",
      "status": "allocated",
      "to": {
        "agent": "STREAM-B"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-008",
      "title": "Sitting C harness: abort a cell on non-2xx select-platform; wait for the previous run to be idle before the next press",
      "status": "specced",
      "to": {
        "agent": "STREAMING-CLAUDE"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-013",
      "title": "Next Mac build: DEV tip with the rebuilt, re-signed helper",
      "status": "specced",
      "to": {
        "agent": "STREAMING-CLAUDE"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-015",
      "title": "Publish the DEV download (DMG + release.json with connectScheme) on the DEV board",
      "status": "specced",
      "to": {
        "agent": "STREAMING-CLAUDE"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-017",
      "title": "B5 contract half: replace the SHAAN_PRESENT literal with who pressed",
      "status": "specced",
      "to": {
        "agent": "STREAMING-CLAUDE"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-009",
      "title": "Stripchat first press",
      "status": "asked",
      "to": null,
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-016",
      "title": "S5: prove her own press end to end",
      "status": "asked",
      "to": {
        "agent": "STREAMING-CLAUDE"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "sgl-018",
      "title": "Production release deploy (prod b00b87c lacks workspace-release.json)",
      "status": "asked",
      "to": {
        "agent": "STREAMING-CLAUDE"
      },
      "owner": "STREAMING-CLAUDE"
    },
    {
      "id": "op-007",
      "title": "'Connect this Mac' button on the enrol page",
      "status": "built",
      "to": {
        "agent": "OPS-BUILD"
      },
      "owner": "OPS-BUILD"
    },
    {
      "id": "op-008",
      "title": "Her workspace is made on Create and retired on Offboard with no hand step (W1)",
      "status": "built",
      "to": {
        "agent": "OPS-WORKSPACE"
      },
      "owner": "OPS-BUILD"
    },
    {
      "id": "op-012",
      "title": "Onboarding stops counting offboarded models; phone roster names and record header fit",
      "status": "built",
      "to": {
        "agent": "OPS-UX"
      },
      "owner": "OPS-BUILD"
    },
    {
      "id": "op-001",
      "title": "The Operator is usable to onboard and manage a model",
      "status": "building",
      "to": {
        "agent": "OPS-BUILD"
      },
      "his": "make sure that the operator onboardings had like good looks through it so the operator side is actually usable and functional to onboard and manage the girl",
      "owner": "OPS-BUILD"
    },
    {
      "id": "op-010",
      "title": "Ops Hub as clean as the HALO CRM: walk every page and flow and fix what is broken or ugly",
      "status": "building",
      "to": {
        "agent": "OPS-UX"
      },
      "his": "The Ops Hub should literally be one of the nicest, cleanest fucking things out there",
      "owner": "OPS-BUILD"
    },
    {
      "id": "op-014",
      "title": "HALO's Operator nav carries Admin & help and the board's bell",
      "status": "building",
      "to": {
        "agent": "HALO-UI"
      },
      "owner": "OPS-BUILD"
    },
    {
      "id": "op-011",
      "title": "The empty Operator side nav",
      "status": "allocated",
      "to": {
        "agent": "HALO-UI"
      },
      "his": "I clicked the side nav. Nothing shows on the side nav on the Angels app ... For the operator ... the operator shit on the left-hand side doesn't even have anything ... I don't know where everything's gone.",
      "owner": "OPS-BUILD"
    },
    {
      "id": "op-013",
      "title": "A wrong Operator address says the page doesn't exist",
      "status": "allocated",
      "to": {
        "agent": "OPS-UX"
      },
      "owner": "OPS-BUILD"
    },
    {
      "id": "op-004",
      "title": "Attendance written back to the CRM for a mapped test creator",
      "status": "specced",
      "to": null,
      "owner": "OPS-BUILD"
    },
    {
      "id": "op-015",
      "title": "Looks-bad list: one Operator page template like HALO's, the permanent 'source degraded' line, engineer pages, names, counts, phone hero",
      "status": "specced",
      "to": null,
      "owner": "OPS-BUILD"
    },
    {
      "id": "op-016",
      "title": "Production: the Operator switched on in HALO with the first real model onboarding, and the board release",
      "status": "specced",
      "to": null,
      "owner": "OPS-BUILD"
    },
    {
      "id": "hu-005",
      "title": "Improve 2-3 daily pages in code (Game Board numbers, phone top, name card): halocrm #82",
      "status": "built",
      "to": {
        "agent": "HALO-UI"
      },
      "his": "Shaan 23:45: \"i just wanted like good ui components\"",
      "owner": "HALO-UI"
    },
    {
      "id": "hu-013",
      "title": "Operator inside HALO: Admin pages, Live now list, Operator in HALO's bell: halocrm #101 (HALO side)",
      "status": "built",
      "to": {
        "agent": "HALO-UI"
      },
      "his": "A0 (OPS-UX ask 2): \"Admin/Help/System info/Release notes + the live list in HALO's Operator pages; the board bell into HALO's bell, DEV first, then before/after for Shaan\"",
      "owner": "HALO-UI"
    },
    {
      "id": "hu-015",
      "title": "Board side of the bell: post 'notifications' from HaloEmbedBridge",
      "status": "allocated",
      "to": {
        "agent": "OPS-UX"
      },
      "his": "OPS-UX 13:43: \"route the board bell into HALO's bell\" (owners HALO-UI contract + OPS-UX board)",
      "owner": "HALO-UI"
    },
    {
      "id": "hu-017",
      "title": "Ask HALO dock covers page content at the bottom",
      "status": "allocated",
      "to": {
        "agent": "HALO-FACE"
      },
      "his": "Found walking every page at 1440 and 390",
      "owner": "HALO-UI"
    },
    {
      "id": "hu-007",
      "title": "Ship #82 (and #101) to live after his look",
      "status": "specced",
      "to": {
        "agent": "HALO-UI"
      },
      "his": "A0 brief: UI changes reach live only after he has looked; then merge and ship like HALO-DEV",
      "owner": "HALO-UI"
    },
    {
      "id": "hu-014",
      "title": "Put #101 on DEV: rebuild origin/sisodev (main + list + branch), back up halo_sisodev, read back health and the Operator view",
      "status": "specced",
      "to": {
        "agent": "HALO-UI"
      },
      "his": "A0: \"You may rebuild sisodev now if both hold ... If (b) is unclear, wait until 19:51\"",
      "owner": "HALO-UI"
    },
    {
      "id": "hu-016",
      "title": "Voice Clone opens 'access is restricted' for Chatter/DCR/VA: grant voice.read or take it off their menu",
      "status": "asked",
      "to": {
        "agent": "HALO-UI"
      },
      "his": "Found in the running app (digest claim #3); product call",
      "owner": "HALO-UI"
    },
    {
      "id": "hu-018",
      "title": "FansMetric answers HTTP_402 'no active subscription' to production's key: live sync likely failing",
      "status": "asked",
      "to": {
        "agent": "HALO-UI"
      },
      "his": "Found on DEV with production's key, 2 Oct 07:40 box time",
      "owner": "HALO-UI"
    },
    {
      "id": "hu-019",
      "title": "8 widget tests fail on main (catalog x4, Voice Clone x4)",
      "status": "asked",
      "to": {
        "agent": "HALO-UI"
      },
      "his": "Found running test:widgets on main abafffd7",
      "owner": "HALO-UI"
    }
  ],
  "needsYou": [
  {
    "id": "T-0044",
    "title": "Read: HALO, what's next (about 10 min)",
    "owner": "HALO-NEXT",
    "link": "http://127.0.0.1:8891/card/halo-next/html",
    "minutes": 10
  },
  {
    "id": "T-0068",
    "title": "Look: HALO's real pages, before and after (10 min)",
    "owner": "HALO-UI",
    "link": "http://127.0.0.1:8891/card/halo-ui/html",
    "minutes": 10
  },
  {
    "id": "T-0074",
    "title": "Stripchat sign-in for the model account, under 2 min: be signed in to sisodev.haloangels.net (Operator), open the link, solve any captcha, c",
    "owner": "STREAM-B via A0",
    "link": "https://opsdev.haloangels.net/board/api/operator-desktop/models/oracle-trillionzrecords-model/vnc.html?autoconnect=1&resize=scale&path=websockify",
    "minutes": 2
  }
],
  "timeline": [
    {
      "at": "2026-10-02 14:31",
      "kind": "report",
      "who": "STREAMING-CLAUDE",
      "text": "plan file created, 24 items, soak sgl-001 running · .agents/plan/streaming-go-live.json"
    },
    {
      "at": "2026-10-02 14:31",
      "kind": "report",
      "who": "OPS-BUILD",
      "text": "plan file created (17 items, 6 checked) · .agents/plan/operator.json"
    },
    {
      "at": "2026-10-02 15:04",
      "kind": "report",
      "who": "HALO-UI",
      "text": "plan on paper: partners/halo/.agents/plan/HALO-UI.json (PLAN-FORMAT.md; 19 asks: 10 checked, 2 built (#82, #101 waiting on Shaan/DEV), 2 specced (ship after his look; sisodev after 19:51), 2 allocated (bell board side OP"
    },
    {
      "at": "2026-10-02 14:48",
      "kind": "board",
      "who": "HALO · infrastructure",
      "text": "Found the biggest load on HALO's server: a forgotten checker, stopped"
    },
    {
      "at": "2026-10-02 14:50",
      "kind": "board",
      "who": "HALO · infrastructure",
      "text": "HALO's server is at about twice its capacity; mostly our own test load"
    },
    {
      "at": "2026-10-02 14:50",
      "kind": "board",
      "who": "HALO · Operator",
      "text": "Onboarding works end to end on the test server"
    },
    {
      "at": "2026-10-02 14:50",
      "kind": "board",
      "who": "HALO · Streaming go-live",
      "text": "End during Start has a real fault; the fix waits for the test to finish"
    },
    {
      "at": "2026-10-02 14:50",
      "kind": "board",
      "who": "HALO · Streaming go-live",
      "text": "The 6-hour test runs on 2 of 3 platforms: Chaturbate and CamSoda, not Stripchat"
    }
  ],
  "health": [
    {
      "icon": "radio-tower",
      "name": "Oracle on DEV",
      "value": "5e072f582 deployed",
      "level": "ok",
      "source": "handoff",
      "at": "2026-10-02 05:05"
    },
    {
      "icon": "monitor-check",
      "name": "Mac app",
      "value": "77352f4f0 · camera preview reads 'error' at launch",
      "level": "warn",
      "source": "handoff",
      "at": "2026-10-02 05:05"
    },
    {
      "icon": "layout-dashboard",
      "name": "Live CRM",
      "value": "dc7c9e29 · untouched",
      "level": "ok",
      "source": "handoff",
      "at": "2026-10-02 05:05"
    },
    {
      "icon": "server",
      "name": "HALO server load",
      "value": "forgotten checker stopped 14:46; HEALTH watching",
      "level": "warn",
      "source": "board",
      "at": "2026-10-02 14:48"
    },
    {
      "icon": "timer",
      "name": "6 h soak gate",
      "value": "1 h of 6 h · rerun waits on the charger",
      "level": "bad",
      "source": "handoff",
      "at": "2026-10-02 06:55"
    }
  ],
  "spendToday": null
};
const agents: DashboardAgent[] = [
  {
    "name": "STREAM-A",
    "kind": "worker",
    "project": "HALO",
    "owner": "STREAMING-CLAUDE",
    "icon": "radio-tower",
    "accent": "var(--accent-tasks)",
    "harness": "claude",
    "model": "Opus 5.5",
    "machine": "laptop",
    "state": "idle",
    "spunUp": true
  },
  {
    "name": "STREAM-B",
    "kind": "worker",
    "project": "HALO",
    "owner": "STREAMING-CLAUDE",
    "icon": "radio-tower",
    "accent": "var(--accent-tasks)",
    "harness": "claude",
    "model": "Opus 5.5",
    "machine": "laptop",
    "state": "idle",
    "spunUp": true
  },
  {
    "name": "AUTO-VIEWER",
    "kind": "worker",
    "project": "HALO",
    "owner": "STREAMING-CLAUDE",
    "icon": "radio-tower",
    "accent": "var(--accent-tasks)",
    "harness": "claude",
    "model": "Opus 5.5",
    "machine": "laptop",
    "state": "done",
    "spunUp": true
  },
  {
    "name": "OPS-WORKSPACE",
    "kind": "worker",
    "project": "HALO",
    "owner": "OPS-BUILD",
    "icon": "gauge",
    "accent": "var(--accent-tasks)",
    "harness": "claude",
    "model": "Opus 5.5",
    "machine": "laptop",
    "state": "done",
    "spunUp": true
  },
  {
    "name": "OPS-UX",
    "kind": "worker",
    "project": "HALO",
    "owner": "OPS-BUILD",
    "icon": "gauge",
    "accent": "var(--accent-tasks)",
    "harness": "claude",
    "model": "Opus 5.5",
    "machine": "laptop",
    "state": "idle",
    "spunUp": true
  },
  {
    "name": "HALO-FACE",
    "kind": "worker",
    "project": "HALO",
    "owner": "HALO-UI",
    "icon": "layout-dashboard",
    "accent": "var(--accent-tasks)",
    "harness": "claude",
    "model": "Opus 5.5",
    "machine": "laptop",
    "state": "idle",
    "spunUp": true
  }
];
const params = new URLSearchParams(location.search);
if (params.has("empty")) { project.owners = []; project.open = []; project.health = []; project.timeline = []; project.needsYou = []; for (const state of Object.keys(project.counts)) project.counts[state as keyof typeof project.counts] = 0; }
if (params.has("evidence")) { project.open[0].his = "End during Start wins."; project.open[0].evidence = ["Lab probe: accepted End prevents any subsequent start or push.", "Malformed payload <script>alert(1)</script> stays text."]; }
document.body.style.overflow = "auto";
document.body.style.userSelect = "auto";
createRoot(document.getElementById("root")!).render(createElement(ProjectDashboard, { project, agents, onOpen: (name: string) => { document.title = `Open ${name}`; }, onGroup: (group: string) => { document.title = `Open ${group}`; }, onNeed: (need: HubProject["needsYou"][number]) => { document.title = `Needs you: ${need.id}`; } }));
