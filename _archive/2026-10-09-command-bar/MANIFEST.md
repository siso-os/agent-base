# Archived 2026-10-09 by AGENT-BASE (AB-swap 3, t-0461)

- CommandBar.tsx: the hub's org command bar (owner faces and a crumb trail). Nothing imported it after 8 Oct, when
  4795c7c8 folded the browser's command bar into the one ⌘K Spotlight (WorkspaceCommandPalette, `uihub: arc:command-palette`).
  UI-HUB's swap said "archive the dead CommandBar and CommandCrumbs"; CommandCrumbs was already gone. Was apps/web/src/components/.
