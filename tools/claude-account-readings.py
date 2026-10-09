#!/usr/bin/env python3
"""Read the existing renewals/claude-credits functions for two allowed logins.
No sampling, notifications, account emails or raw errors leave this process.
Fahmy's config is never passed to either reader. Importing a command does not run main.
"""
import datetime as dt
import json
import os
import runpy
import contextlib
import io
from concurrent.futures import ThreadPoolExecutor

ALLOWED = {"claude-siso": ("~/.claude-siso", "~/.config/claude-siso"),
           "claude-siso-3": ("~/.config/claude-siso-3",)}


def profile(config):
    if not isinstance(config, str):
        return None
    resolved = os.path.abspath(os.path.expanduser(config))
    return next((key for key, paths in ALLOWED.items() if resolved in
                 [os.path.abspath(os.path.expanduser(p)) for p in paths]), None)


def renewals(reader):
    rows = []
    try:
        with open(reader["CONF"]) as source:
            plans = json.load(source).get("plans", [])
        for plan in plans:
            key = profile(plan.get("config"))
            if not key or plan.get("kind") != "claude":
                continue
            try:
                value = reader["claude_plan"](plan, dt.datetime.now(dt.timezone.utc))
                rows.append({"id": key, "renews": value.get("renews"),
                             "renewalStatus": value.get("status")})
            except Exception:
                rows.append({"id": key, "renews": None})
    except Exception:
        pass
    return rows


def credits(reader):
    # read_all looks up LOGINS in its own globals. Restrict before any credential access.
    read = reader["read_all"]
    read.__globals__["LOGINS"] = [(key, config) for key, config in reader["LOGINS"]
                                  if key in ALLOWED and profile(config) == key]
    rows = []
    for value in read():
        if value.get("login") not in ALLOWED:
            continue
        rows.append({"id": value["login"], "credits": None if value.get("error") else [
            {"left": grant.get("left_usd"), "ends": grant.get("ends")}
            for grant in value.get("grants", [])]})
    return rows


def main():
    workspace = os.path.expanduser("~/SISO_Workspace/SISO_Agents")
    def one(path, read):
        try:
            return read(runpy.run_path(path, run_name="account_reader"))
        except Exception:
            return []
    # Keep any diagnostic print from a donor reader out of the JSON transport.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(one, workspace + "/agent-zero/siso-agent-zero/bin/renewals", renewals)
            b = pool.submit(one, workspace + "/siso-harness-lab/bin/claude-credits", credits)
            result = {"renewals": a.result(), "credits": b.result()}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
