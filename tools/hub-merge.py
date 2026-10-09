#!/usr/bin/env python3
"""Resolve a ui-hub/components.json merge conflict: ours plus every component/page only theirs has (by id)."""
import json, subprocess
ours = json.loads(subprocess.check_output(["git", "show", ":2:ui-hub/components.json"]))
theirs = json.loads(subprocess.check_output(["git", "show", ":3:ui-hub/components.json"]))
byid = {c["id"]: c for c in ours["components"]}
for c in theirs["components"]:
    mine = byid.get(c["id"])
    if not mine: ours["components"].append(c); continue
    have = {p["id"] for p in mine["pages"]}
    mine["pages"] += [p for p in c["pages"] if p["id"] not in have]
json.dump(ours, open("ui-hub/components.json", "w"), indent=2, ensure_ascii=False)
print("merged", sum(len(c["pages"]) for c in ours["components"]), "pages")
