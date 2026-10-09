# Agent Base · UI hub

Shaan, 4 Oct: "we should have like a ui hub just for ... the agent base ... a bunch of different components that we're
working on ... save all context and improvements ... improvements log and reasoning log and feedback log ... so any agent
when they want to pick up and iterate on this component they've got the exact history and reasoning and feedback and ideas
... so they don't have to re-derive it."

View it: `http://127.0.0.1:8896/` (start it with `python3 ui-hub/serve.py`). It is one app: a side nav of components and docs, logs rendered as pages, and links between them that stay in the hub. Routes: `#/<component>/<page>`, `#/doc/vision`.

## One folder per component
| File | What goes in it |
|---|---|
| `README.md` | What the component is FOR (his words), where its code is, what is locked, open threads. Read this first. |
| `component.json` | This component's catalog record: stable `id`, display metadata, pages and optional proof references. Its owner edits this file independently. |
| `FEEDBACK.md` | His words, verbatim, dated, with what they decided. Never paraphrase; add to the top. |
| `REASONING.md` | Why each design choice was made, and what was rejected and why. |
| `IDEAS.md` | Every idea offered, with its status: picked / built / dropped (+ his reason) / open. |
| `IMPROVEMENTS.md` | What changed, round by round, with commits and the shots folder. |
| `index.html` | The current state as pictures: the URL to give him. |
| `shots/rN/` | Each round's crops (WebP), so a later round can show before and after. |

## The loop
The `ui-loop` skill (`.claude/skills/ui-loop/SKILL.md`): `tools/ui-round <name>` shoots the real app at every width
against a fixture node. Crop into `shots/rN/`, update `index.html`, then `node tools/ui-check.mjs <url> <png>`, then send him the URL.
After his reaction, add to FEEDBACK first, then the rest.

## Adding a component
1. Copy `_template/` to `ui-hub/<id>/` and fill in the README first (what it's FOR, in his words).
2. Add `ui-hub/<id>/component.json` with the matching id, name, accent colour, status, summary, and pages (Markdown logs and picture pages). IDs use lowercase letters, digits, `_` and `-`, start with a letter or `_`, and have at most 80 characters. Page/proof IDs must also be unique within their list; file paths stay inside the component directory.
3. The product map reads these manifests directly. For the static hub (`index.html` + `hub.js`) and other existing consumers, export the compatibility catalog from the repo root with `node --experimental-strip-types tools/ui-hub-catalog.mjs sync`. The hub then gives it a side-nav entry, home page, rendered logs and prev/next.

## Catalog ownership and compatibility

Edit the component's own `component.json`; do not edit its generated row in `components.json`. The reader preserves the existing catalog order, envelope metadata (`hub`, `docs`, and unknown fields), and legacy-only rows. Manifests override their matching row; unknown legacy fields survive partial manifests. New manifests append in ID order. Removing a manifest leaves its legacy row in place; removing a component entirely is a separate reviewed catalog change.

`node --experimental-strip-types tools/ui-hub-catalog.mjs check` validates records and exits 1 when the static export is stale, without writing anything. `sync` atomically regenerates only `components.json` and is a no-op when current. Both accept an optional hub-root argument for isolated fixtures. Invalid IDs, duplicate IDs, malformed records, unsafe paths and symlinked registered components fail rather than silently disappearing. Unregistered symlink directories are never discovered.

`surface.json` remains the separate user-rating and work-state record. Catalog migration and sync never create ratings, screenshots or proof claims. Existing display statuses are retained verbatim and are not new evidence of a live release.

## Components
- `input-bar/`: active (round 5).
- `side-nav/`: queued; spec ready.
- `agent-zero-board/`: queued; specs ready.
