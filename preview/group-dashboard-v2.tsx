import { createElement } from "../apps/web/node_modules/react";
import { createRoot } from "../apps/web/node_modules/react-dom/client";
import { GroupDashboard, type GroupProject, type GroupClient, type GroupAgent } from "../apps/web/src/components/GroupDashboard";
import "../apps/web/src/index.css";
// Snapshot fixtures: hub-design/data.json and Agency clients/CLIENTS.json, 2 Oct 2026.
const projects: GroupProject[] = [
  {
    "id": "halo",
    "name": "HALO",
    "group": "agency",
    "line": "Cam Kellman’s creator agency: Oracle streaming, the Operator, the CRM.",
    "accent": "var(--accent-tasks)",
    "icon": "chess-king",
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
    "owners": [
      {
        "name": "STREAMING-CLAUDE",
        "role": "Go-live",
        "domain": "Oracle go-live: the Mac app, the server path, every platform, the proofs, the production release",
        "icon": "radio-tower",
        "state": "done",
        "spunUp": true,
        "holding": {
          "id": "sgl-001",
          "title": "Production gate: one Operator press held live 6 h on DEV with every platform that passed its first press",
          "status": "building"
        },
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
        }
      },
      {
        "name": "OPS-BUILD",
        "role": "Operator",
        "domain": "Oracle Operator / Ops Hub: the board, onboarding a model, her workspace, Offboard, how it looks",
        "icon": "gauge",
        "state": "idle",
        "spunUp": true,
        "holding": {
          "id": "op-001",
          "title": "The Operator is usable to onboard and manage a model",
          "status": "building"
        },
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
        }
      },
      {
        "name": "HALO-UI",
        "role": "CRM",
        "domain": "HALO CRM UI from the running app (HALO-UI lane)",
        "icon": "layout-grid",
        "state": "done",
        "spunUp": true,
        "holding": {
          "id": "op-014",
          "title": "HALO's Operator nav carries Admin & help and the board's bell",
          "status": "building"
        },
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
          "working": 1
        }
      }
    ],
    "needsYou": [
      {
        "id": "T-0044",
        "title": "Read: HALO, what's next (about 10 min)",
        "project": "-",
        "owner": "HALO-NEXT",
        "link": "http://127.0.0.1:8891/card/halo-next/html"
      },
      {
        "id": "T-0058",
        "title": "Look at Halo's dock round 7: the model app's own chat inside the dock, message box pinned to the bottom (2 min)",
        "project": "-",
        "owner": "HALO-FACE",
        "link": "http://127.0.0.1:8891/card/halo-dock/html"
      },
      {
        "id": "T-0068",
        "title": "Look: HALO's real pages, before and after (10 min)",
        "project": "-",
        "owner": "HALO-UI",
        "link": "http://127.0.0.1:8891/card/halo-ui/html"
      },
      {
        "id": "T-0074",
        "title": "Stripchat sign-in for the model account, under 2 min: be signed in to sisodev.haloangels.net (Operator), open the link, solve any captcha, c",
        "project": "halo-streaming",
        "owner": "STREAM-B via A0",
        "link": "https://opsdev.haloangels.net/board/api/operator-desktop/models/oracle-trillionzrecords-model/vnc.html?autoconnect=1&resize=scale&path=websockify"
      }
    ],
    "timeline": [
      {
        "at": "2026-10-02T14:48:00+07:00",
        "kind": "board",
        "who": "Board",
        "text": "Found the biggest load on HALO's server: a forgotten checker, stopped"
      },
      {
        "at": "2026-10-02T14:50:00+07:00",
        "kind": "board",
        "who": "Board",
        "text": "HALO's server is at about twice its capacity; mostly our own test load"
      },
      {
        "at": "2026-10-02T14:50:00+07:00",
        "kind": "board",
        "who": "Board",
        "text": "Onboarding works end to end on the test server"
      },
      {
        "at": "2026-10-02T14:50:00+07:00",
        "kind": "board",
        "who": "Board",
        "text": "End during Start has a real fault; the fix waits for the test to finish"
      },
      {
        "at": "2026-10-02T14:50:00+07:00",
        "kind": "board",
        "who": "Board",
        "text": "The 6-hour test runs on 2 of 3 platforms: Chaturbate and CamSoda, not Stripchat"
      }
    ],
    "spendToday": null
  },
  {
    "id": "agent-base",
    "name": "Agent Base",
    "group": "labs",
    "line": "Shaan’s own agent coding app. One window onto the whole crew.",
    "accent": "var(--siso-orange)",
    "icon": "layout-panel-top",
    "counts": {
      "asked": 8,
      "specced": 37,
      "allocated": 4,
      "building": 3,
      "built": 31,
      "checked": 38,
      "parked": 1,
      "dropped": 1
    },
    "owners": [
      {
        "name": "AGENT-BASE",
        "role": "Agent Base",
        "domain": "Agent Base, the app",
        "icon": "panels-top-left",
        "state": "off",
        "spunUp": false,
        "holding": {
          "id": "a0-013",
          "title": "Fan out by default; one living document per task",
          "status": "building"
        },
        "plan": {
          "checked": 38,
          "total": 123,
          "counts": {
            "asked": 8,
            "specced": 37,
            "allocated": 4,
            "building": 3,
            "built": 31,
            "checked": 38,
            "parked": 1,
            "dropped": 1
          }
        },
        "workers": {
          "total": 28,
          "working": 15
        }
      }
    ],
    "needsYou": [],
    "timeline": [
      {
        "at": "2026-10-02T14:50:00+07:00",
        "kind": "board",
        "who": "Board",
        "text": "Agent Base's queue split into parallel lanes"
      }
    ],
    "spendToday": null
  },
  {
    "id": "efficiency",
    "name": "Efficiency",
    "group": "labs",
    "line": "The agent stack, routing, and the cost of getting things done.",
    "accent": "var(--accent-reflect)",
    "icon": "zap",
    "counts": {
      "asked": 2,
      "specced": 1,
      "allocated": 0,
      "building": 1,
      "built": 0,
      "checked": 12,
      "parked": 0,
      "dropped": 0
    },
    "owners": [
      {
        "name": "EFFICIENCY",
        "role": "Efficiency",
        "domain": "Efficiency: what each finished item costs on the Claude plan and Codex credits",
        "icon": "zap",
        "state": "done",
        "spunUp": true,
        "holding": {
          "id": "a0-002",
          "title": "Optimise the agent stack from first principles; caps on a scale",
          "status": "building"
        },
        "plan": {
          "checked": 12,
          "total": 16,
          "counts": {
            "asked": 2,
            "specced": 1,
            "allocated": 0,
            "building": 1,
            "built": 0,
            "checked": 12,
            "parked": 0,
            "dropped": 0
          }
        },
        "workers": {
          "total": 4,
          "working": 1
        }
      }
    ],
    "needsYou": [],
    "timeline": [
      {
        "at": "2026-10-02T14:50:00+07:00",
        "kind": "board",
        "who": "Board",
        "text": "Codex credits: ~60k, Luna 80% / Sol 20%, ~15k a day until 7 Oct"
      }
    ],
    "spendToday": null
  },
  {
    "id": "health",
    "name": "Health",
    "group": "labs",
    "line": "Keep the laptop estate working safely.",
    "accent": "var(--accent-health)",
    "icon": "stethoscope",
    "counts": {
      "asked": 2,
      "specced": 0,
      "allocated": 2,
      "building": 3,
      "built": 0,
      "checked": 2,
      "parked": 0,
      "dropped": 0
    },
    "owners": [
      {
        "name": "HEALTH",
        "role": "Laptop health",
        "domain": "Machine health",
        "icon": "heart-pulse",
        "state": "working",
        "spunUp": true,
        "holding": {
          "id": "a0-005",
          "title": "HALO VPS overload: our test load off the client's box",
          "status": "building"
        },
        "plan": {
          "checked": 2,
          "total": 9,
          "counts": {
            "asked": 2,
            "specced": 0,
            "allocated": 2,
            "building": 3,
            "built": 0,
            "checked": 2,
            "parked": 0,
            "dropped": 0
          }
        },
        "workers": {
          "total": 0,
          "working": 0
        }
      }
    ],
    "needsYou": [],
    "timeline": [],
    "spendToday": null
  }
];
const clients: GroupClient[] = [
  {
    "folder": "../partners/halo",
    "kind": "partner",
    "note": "HALO, Cam Kellman's agency: the biggest thing SISO runs",
    "people": [
      "Cam Kellman"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "halo",
    "name": "HALO",
    "pinned": false,
    "icon": "chess-king"
  },
  {
    "folder": "../partners/fahmy",
    "kind": "partner",
    "note": "Fahmy's agency (Bykonz Yard and its clients)",
    "people": [
      "Fahmy"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "fahmy",
    "name": "Fahmy’s agency",
    "pinned": true,
    "icon": "heart-handshake"
  },
  {
    "folder": "buildstockpro",
    "kind": "friend-favour",
    "note": "free work for a friend",
    "people": [
      "Ray Cannon"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "buildstockpro",
    "name": "Buildstockpro",
    "pinned": false,
    "icon": "construction"
  },
  {
    "folder": "construction-rc",
    "kind": "friend-favour",
    "note": "Ray Cannon's project again",
    "people": [
      "Ray Cannon"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "construction-rc",
    "name": "Construction Rc",
    "pinned": false,
    "icon": "hammer"
  },
  {
    "folder": "cafe-89",
    "kind": "friend-favour",
    "note": "personal one for friends in Vietnam who've been really nice to him; get their WhatsApp later",
    "people": [
      "Ha",
      "Fang"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "cafe-89",
    "name": "Cafe 89",
    "pinned": false,
    "icon": "coffee"
  },
  {
    "folder": "visa-run-da-nang",
    "kind": "friend-favour",
    "note": "for a nice visa-run lady in Da Nang; a client, but he'd do it free",
    "people": [],
    "on_rolodex": true,
    "place": "agency",
    "id": "visa-run-da-nang",
    "name": "Visa Run Da Nang",
    "pinned": false,
    "icon": "plane-takeoff"
  },
  {
    "folder": "siso-fullora",
    "kind": "lead",
    "note": "'for Laura': Tristan's; Tristan has clients needing help (China sourcing; an app getting subs). A0: folder name read as 'for Laura', unconfirmed",
    "people": [
      "Tristan"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "siso-fullora",
    "name": "For Laura (unconfirmed)",
    "pinned": false,
    "icon": "layers"
  },
  {
    "folder": "provider-compliance-2026-08",
    "kind": "client",
    "note": "from Harrison, who will send more clients",
    "people": [
      "Harrison"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "provider-compliance-2026-08",
    "name": "Provider Compliance 2026 08",
    "pinned": false,
    "icon": "shield-check"
  },
  {
    "folder": "five-star-hire",
    "kind": "template",
    "note": "car hire template; may become live: Nick Mearson has car-hire and gym clients",
    "people": [
      "Nick Mearson"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "five-star-hire",
    "name": "Five Star Hire",
    "pinned": false,
    "icon": "user-check"
  },
  {
    "folder": "restaurant-app",
    "kind": "template",
    "note": "restaurant industry template under affiliate Dickie (met in Bali); didn't work out, still wants to do business",
    "people": [
      "Dickie"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "restaurant-app",
    "name": "Restaurant App",
    "pinned": false,
    "icon": "cooking-pot"
  },
  {
    "folder": "bike-rental",
    "kind": "template",
    "note": "template, no client",
    "people": [],
    "on_rolodex": true,
    "place": "agency",
    "id": "bike-rental",
    "name": "Bike Rental",
    "pinned": false,
    "icon": "route"
  },
  {
    "folder": "tour-guides",
    "kind": "template",
    "note": "industry template",
    "people": [],
    "on_rolodex": true,
    "place": "agency",
    "id": "tour-guides",
    "name": "Tour Guides",
    "pinned": false,
    "icon": "compass"
  },
  {
    "folder": "lumelle",
    "kind": "offboarded",
    "note": "old client, off-boarded (relations strained: took too long); now an e-commerce template; NOT on the Rolodex; came through Sam (patchwork)",
    "people": [
      "Sam (patchwork)"
    ],
    "on_rolodex": false,
    "place": "agency",
    "id": "lumelle",
    "name": "Lumelle",
    "pinned": false,
    "icon": "cart"
  },
  {
    "folder": "patchwork-store",
    "kind": "client",
    "note": "linked to Sam (patchwork), who brought Lumelle. A0: relation read from his words, unconfirmed",
    "people": [
      "Sam (patchwork)"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "patchwork-store",
    "name": "Patchwork Store",
    "pinned": false,
    "icon": "palette"
  },
  {
    "folder": "business-to-government",
    "kind": "declined",
    "note": "referral from an affiliate ('my gum'); he doesn't want it: the affiliate cut is more than he's comfortable paying",
    "people": [
      "the 'my gum' affiliate"
    ],
    "on_rolodex": false,
    "place": "agency",
    "id": "business-to-government",
    "name": "Business To Government",
    "pinned": false,
    "icon": "stamp"
  },
  {
    "folder": "thehrworld",
    "kind": "unknown",
    "note": "he's not sure where it came from",
    "people": [],
    "on_rolodex": true,
    "place": "agency",
    "id": "thehrworld",
    "name": "Thehrworld",
    "pinned": false,
    "icon": "users"
  },
  {
    "folder": "blackbox4",
    "kind": "moved",
    "note": "the black boxes: belongs under SISO Labs · agent systems, not the agency",
    "people": [],
    "on_rolodex": true,
    "place": "labs",
    "id": "blackbox4",
    "name": "Blackbox4",
    "pinned": false,
    "icon": "box"
  },
  {
    "folder": "../partners/fahmy/(melanotresses)",
    "kind": "partner-client",
    "note": "MelanoTresses: one of Fahmy's clients",
    "people": [
      "Fahmy"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "melanotresses",
    "name": "MelanoTresses",
    "pinned": false,
    "icon": "sparkles"
  },
  {
    "folder": "../partners/halo/clients/college-besties",
    "kind": "partner-client",
    "note": "College Besties: a site made for HALO",
    "people": [
      "Cam Kellman"
    ],
    "on_rolodex": true,
    "place": "agency",
    "id": "college-besties",
    "name": "College Besties",
    "pinned": false,
    "icon": "graduation-cap"
  },
  {
    "folder": "actionmodel",
    "kind": "unknown",
    "note": "not covered in his 2 Oct rundown",
    "people": [],
    "on_rolodex": true,
    "place": "agency",
    "id": "actionmodel",
    "name": "Actionmodel",
    "pinned": false,
    "icon": "bot"
  },
  {
    "folder": "home-essentials",
    "kind": "unknown",
    "note": "not covered in his 2 Oct rundown",
    "people": [],
    "on_rolodex": true,
    "place": "agency",
    "id": "home-essentials",
    "name": "Home Essentials",
    "pinned": false,
    "icon": "home"
  }
];
const agents: GroupAgent[] = [
  {
    "name": "HALO-FACE",
    "owner": "HALO-UI",
    "role": "Halo dock (placed by folder; Agent Zero to confirm)",
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": {
      "id": "hu-017",
      "title": "Ask HALO dock covers page content at the bottom",
      "status": "allocated"
    }
  },
  {
    "name": "S1-BROWSER",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": {
      "id": "ab-022",
      "title": "The browser that lets him close cmux and Arc: Arc's pinned tabs come over and stay pinned, a login per profile/company that persists, YouTube and his music play",
      "status": "building"
    }
  },
  {
    "name": "EFFICIENCY",
    "owner": "EFFICIENCY",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "HUB-1",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "HUB-2",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "HUB-3",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "HUB-4",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "HUB-5",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "HUB-6",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "HUB-7",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "HUB-DESIGN",
    "owner": "AGENT-BASE",
    "role": "Opus design owner for dashboards, project pages, hover cards and Agent Zero's page",
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "T10-ROLODEX",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "T11-SPEND",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "T12-CHECKPOINTS",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "T13-UPDATE",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "T14-MOVE",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "T15-NOTIFY",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "working",
    "spunUp": true,
    "holding": null
  },
  {
    "name": "AGENT-BASE-BUILD",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": {
      "id": "ab-086",
      "title": "Projects and owners in the side nav: projects as folders, owners inside, workers hidden as a count",
      "status": "building"
    }
  },
  {
    "name": "AUTO-VIEWER",
    "owner": "STREAMING-CLAUDE",
    "role": "Test viewer: natural chats and 1-token tips, read back in Oracle",
    "icon": "terminal",
    "state": "done",
    "spunUp": true,
    "holding": {
      "id": "sgl-011",
      "title": "AUTO-VIEWER: one natural chat + one 1-token tip reach Oracle exactly once, per platform",
      "status": "building"
    }
  },
  {
    "name": "OPS-UX",
    "owner": "OPS-BUILD",
    "role": "Ops Hub quality: every page and flow against the HALO CRM",
    "icon": "terminal",
    "state": "idle",
    "spunUp": true,
    "holding": {
      "id": "op-010",
      "title": "Ops Hub as clean as the HALO CRM: walk every page and flow and fix what is broken or ugly",
      "status": "building"
    }
  },
  {
    "name": "OPS-WORKSPACE",
    "owner": "OPS-BUILD",
    "role": "Her server workspace: created on Create, removed on Offboard",
    "icon": "terminal",
    "state": "done",
    "spunUp": true,
    "holding": {
      "id": "a0-006",
      "title": "Cloudflare tunnel token visible in ps on halo-vps",
      "status": "allocated"
    }
  },
  {
    "name": "S2-STUCK",
    "owner": "AGENT-BASE",
    "role": "Codex worker for AGENT-BASE",
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": {
      "id": "ab-130",
      "title": "BUG: messages get stuck in chats (reproduce, failing test, fix)",
      "status": "allocated"
    }
  },
  {
    "name": "STREAM-A",
    "owner": "STREAMING-CLAUDE",
    "role": "Mac app: Start/End, the live screen, the reply box",
    "icon": "terminal",
    "state": "idle",
    "spunUp": true,
    "holding": {
      "id": "sgl-005",
      "title": "Board Stop command reads failed although the stream went dark",
      "status": "allocated"
    }
  },
  {
    "name": "STREAM-B",
    "owner": "STREAMING-CLAUDE",
    "role": "Platform sign-ins and her browser: Stripchat, CamSoda, signing in from her app",
    "icon": "terminal",
    "state": "done",
    "spunUp": true,
    "holding": {
      "id": "sgl-026",
      "title": "CamSoda public-truth probe cadence: 30-60 s idle, ~15 s while a run is live (today ~6 s, a new renderer each read)",
      "status": "allocated"
    }
  },
  {
    "name": "HUB-8",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "L1-TOKENS",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "L2-CI",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "L3-ORG",
    "owner": "AGENT-BASE",
    "role": "Codex worker for AGENT-BASE",
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "L4-DEV",
    "owner": "AGENT-BASE",
    "role": "Codex worker for AGENT-BASE",
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "MOVE-PROBE",
    "owner": "EFFICIENCY",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "SISO-HARNESS-LAB",
    "owner": "EFFICIENCY",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "T3-GROUP-DASH",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "T4-PROJECT-PAGE",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "T5-MENU-PICKER",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "T6-OWNER-TASKS",
    "owner": "AGENT-BASE",
    "role": "Codex worker for AGENT-BASE",
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "T7-ANNOUNCE",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "T8-CREW-CODEX",
    "owner": "AGENT-BASE",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  },
  {
    "name": "TELL-PROBE",
    "owner": "EFFICIENCY",
    "role": null,
    "icon": "terminal",
    "state": "off",
    "spunUp": false,
    "holding": null
  }
];
const params = new URLSearchParams(location.search);
const group = params.get("group") === "labs" ? "labs" : params.get("group") === "family" ? "family" : "agency";
const root = createRoot(document.getElementById("dashboard")!);
function render() {
  root.render(createElement(GroupDashboard, {
    group, agents: params.has("empty") || params.has("noCrew") ? [] : agents, projects: params.has("empty") ? [] : projects, clients: params.has("empty") ? [] : clients,
    onOpen: (id: string) => { document.getElementById("action")!.textContent = `Opened ${id}`; },
    onPin: (id: string) => { const client = clients.find(c => c.id === id); if (client) client.pinned = !client.pinned; document.getElementById("action")!.textContent = `${client?.pinned ? "Pinned" : "Unpinned"} ${id}`; render(); },
  }));
}
render();
document.querySelectorAll<HTMLAnchorElement>("[data-group]").forEach(link => link.classList.toggle("active", link.dataset.group === group));
