#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TASK_TMP=$(mktemp -d "${TMPDIR%/}/.ab-int-test.XXXXXX")
SERVER_PID=''
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$TASK_TMP"
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

fixture=$TASK_TMP/ship
mkdir -p "$fixture/seed"
git -C "$fixture/seed" init -q -b main
git -C "$fixture/seed" config user.name test
git -C "$fixture/seed" config user.email test@example.invalid
mkdir -p "$fixture/seed/.agents" "$fixture/seed/tools"
cp "$ROOT/tools/ab-ship" "$fixture/seed/tools/ab-ship"
printf '{"name":"ship-fixture","scripts":{"check":"echo pnpm-check-ok"}}\n' > "$fixture/seed/package.json"
printf 'base\n' > "$fixture/seed/conflict.txt"
git -C "$fixture/seed" add .
git -C "$fixture/seed" commit -qm base
git clone -q --bare "$fixture/seed" "$fixture/origin.git"
git -C "$fixture/seed" remote add origin "$fixture/origin.git"
git -C "$fixture/seed" push -q -u origin main
git clone -q "$fixture/origin.git" "$fixture/repo"
git -C "$fixture/repo" config user.name test
git -C "$fixture/repo" config user.email test@example.invalid
mkdir -p "$fixture/repo/.agents"
git -C "$fixture/repo" worktree add -q --detach "$fixture/merge" origin/main

git -C "$fixture/repo" switch -qc conflict
printf 'branch side\n' > "$fixture/repo/conflict.txt"
printf '{"tests":"true"}\n' > "$fixture/repo/.agents/ship.json"
git -C "$fixture/repo" add . && git -C "$fixture/repo" commit -qm conflict-branch
git -C "$fixture/repo" push -q -u origin conflict
git -C "$fixture/repo" switch -q main
printf 'main side\n' > "$fixture/repo/conflict.txt"
git -C "$fixture/repo" add conflict.txt && git -C "$fixture/repo" commit -qm main-change
git -C "$fixture/repo" push -q origin main
if (cd "$fixture/repo" && AB_ON_MINI=1 AB_MERGE_WORKTREE="$fixture/merge" AB_SHIP_LOG="$fixture/ship.jsonl" tools/ab-ship conflict) >"$TASK_TMP/conflict.out" 2>&1; then fail 'conflicting branch unexpectedly shipped'; fi
grep -q 'conflict.txt' "$TASK_TMP/conflict.out" || { cat "$TASK_TMP/conflict.out" >&2; fail 'conflict path was not reported'; }
[[ "$(git --git-dir="$fixture/origin.git" rev-parse main)" == "$(git -C "$fixture/repo" rev-parse main)" ]] || fail 'conflict changed main'

git -C "$fixture/repo" fetch -q origin
git -C "$fixture/repo" switch -qc green origin/main
mkdir -p "$fixture/repo/.agents"
printf 'green\n' > "$fixture/repo/green.txt"
printf '{"tests":"true"}\n' > "$fixture/repo/.agents/ship.json"
git -C "$fixture/repo" add . && git -C "$fixture/repo" commit -qm green
git -C "$fixture/repo" push -q -u origin green
(cd "$fixture/repo" && AB_ON_MINI=1 AB_MERGE_WORKTREE="$fixture/merge" AB_SHIP_LOG="$fixture/ship.jsonl" tools/ab-ship green) >"$TASK_TMP/green.out" 2>&1 || { cat "$TASK_TMP/green.out"; fail 'green branch did not ship'; }
grep -q 'pnpm-check-ok' "$TASK_TMP/green.out" || fail 'pnpm check was not run'
[[ "$(git --git-dir="$fixture/origin.git" rev-parse main)" == "$(git -C "$fixture/merge" rev-parse HEAD)" ]] || fail 'green merge was not pushed'
python3 - "$fixture/ship.jsonl" <<'PY'
import json,sys
rows=[json.loads(line) for line in open(sys.argv[1])]
assert rows[-1]['result']=='shipped' and rows[-1]['merged_sha']
PY
shipped_main=$(git --git-dir="$fixture/origin.git" rev-parse main)
(cd "$fixture/repo" && AB_ON_MINI=1 AB_MERGE_WORKTREE="$fixture/merge" AB_SHIP_LOG="$fixture/ship.jsonl" tools/ab-ship green) >"$TASK_TMP/already.out" 2>&1 || fail 'already merged branch was not handled idempotently'
grep -q 'already_merged green' "$TASK_TMP/already.out" || fail 'already merged state not reported'
[[ "$(git --git-dir="$fixture/origin.git" rev-parse main)" == "$shipped_main" ]] || fail 'idempotent ship changed main'

deploy=$TASK_TMP/deploy
mkdir -p "$deploy/seed/apps/web" "$deploy/seed/tools"
mkdir -p "$deploy/seed/services/node/src"
cp "$ROOT/tools/ab-deploy" "$deploy/seed/tools/ab-deploy"
printf 'export const fixture = "old";\n' > "$deploy/seed/services/node/src/ship-fixture.ts"
git -C "$deploy/seed" init -q -b main
git -C "$deploy/seed" config user.name test
git -C "$deploy/seed" config user.email test@example.invalid
printf '{"name":"deploy-fixture","scripts":{"build":"mkdir -p apps/web/dist && printf built > apps/web/dist/index.html"}}\n' > "$deploy/seed/package.json"
printf 'old\n' > "$deploy/seed/apps/web/index.html"
printf '/apps/web/dist/\n' > "$deploy/seed/.gitignore"
git -C "$deploy/seed" add . && git -C "$deploy/seed" commit -qm old
(
  cd "$deploy/seed"
  pnpm install --lockfile-only --prefer-offline >/dev/null
)
git -C "$deploy/seed" add pnpm-lock.yaml && git -C "$deploy/seed" commit -qm fixture-lock
git clone -q --bare "$deploy/seed" "$deploy/origin.git"
git -C "$deploy/seed" remote add origin "$deploy/origin.git"
git -C "$deploy/seed" push -q -u origin main
git clone -q "$deploy/origin.git" "$deploy/repo"
git -C "$deploy/repo" config user.name test
git -C "$deploy/repo" config user.email test@example.invalid
git -C "$deploy/repo" worktree add -q --detach "$deploy/live" origin/main
mkdir -p "$deploy/live/apps/web/dist"
printf old-dist > "$deploy/live/apps/web/dist/index.html"
printf 'new\n' > "$deploy/repo/apps/web/index.html"
printf 'export const fixture = "new";\n' > "$deploy/repo/services/node/src/ship-fixture.ts"
git -C "$deploy/repo" add . && git -C "$deploy/repo" commit -qm new
git -C "$deploy/repo" push -q origin main
lab_home="$TASK_TMP/lab-home"
mkdir -p "$lab_home/.local/state/agent-base" "$lab_home/.local/state/context-ping/ctx" "$lab_home/.local/state/herdr-resurrect" "$lab_home/.local/state/agent-base/hosts"
env HOME="$lab_home" AB_PORT=5409 AB_APP_ROOT="$deploy/live" AB_WEB_DIST="$deploy/live/apps/web/dist" \
  AB_REGISTRY="$lab_home/.local/state/agent-base/registry.json" AB_STATE="$lab_home/.local/state/agent-base/rows.json" \
  AB_CTX_DIR="$lab_home/.local/state/context-ping/ctx" AB_RESURRECT_DIR="$lab_home/.local/state/herdr-resurrect" \
  AB_CONSOLE_EVENTS="$lab_home/events.jsonl" AB_MACHINES_FILE="$lab_home/machines.json" \
  AB_HOSTS_DIR="$lab_home/.local/state/agent-base/hosts" AB_UPLOADS="$lab_home/.local/state/agent-base/uploads" \
  node --experimental-strip-types --no-warnings "$ROOT/services/node/src/supervise.ts" >"$TASK_TMP/server.out" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 100); do curl -fsS http://127.0.0.1:5409/api/version >/dev/null 2>&1 && break; sleep .1; done
(cd "$deploy/repo" && env AB_ON_MINI=1 AB_LIVE_WORKTREE="$deploy/live" AB_DEPLOY_PORT=5409 AB_DEPLOY_LOG="$deploy/deploy.jsonl" tools/ab-deploy) >"$TASK_TMP/deploy-success.out" 2>&1 || { cat "$TASK_TMP/deploy-success.out" >&2; fail 'deploy did not pass version probe'; }
newsha=$(git -C "$deploy/repo" rev-parse origin/main)
[[ "$(git -C "$deploy/live" rev-parse HEAD)" == "$newsha" ]] || fail 'live tree did not advance'
[[ "$(cat "$deploy/live/apps/web/dist/index.html")" == built ]] || fail 'new web build not copied'

oldsha=$(git -C "$deploy/live" rev-parse HEAD^)
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=''
git -C "$deploy/live" switch --detach "$oldsha" >/dev/null
printf old-dist > "$deploy/live/apps/web/dist/index.html"
env HOME="$lab_home" AB_PORT=5409 AB_APP_ROOT="$deploy/live" AB_WEB_DIST="$deploy/live/apps/web/dist" \
  AB_REGISTRY="$lab_home/.local/state/agent-base/registry.json" AB_STATE="$lab_home/.local/state/agent-base/rows.json" \
  AB_CTX_DIR="$lab_home/.local/state/context-ping/ctx" AB_RESURRECT_DIR="$lab_home/.local/state/herdr-resurrect" \
  AB_CONSOLE_EVENTS="$lab_home/events.jsonl" AB_MACHINES_FILE="$lab_home/machines.json" \
  AB_HOSTS_DIR="$lab_home/.local/state/agent-base/hosts" AB_UPLOADS="$lab_home/.local/state/agent-base/uploads" \
  node --experimental-strip-types --no-warnings "$ROOT/services/node/src/server.ts" >"$TASK_TMP/server.out" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 100); do curl -fsS http://127.0.0.1:5409/api/version >/dev/null 2>&1 && break; sleep .1; done
(cd "$deploy/repo" && env AB_ON_MINI=1 AB_LIVE_WORKTREE="$deploy/live" AB_DEPLOY_PORT=5409 AB_DEPLOY_LOG="$deploy/deploy.jsonl" AB_PROBE_ATTEMPTS=2 AB_PROBE_INTERVAL=0 tools/ab-deploy) >/dev/null 2>&1 && fail 'broken version probe unexpectedly passed'
[[ "$(git -C "$deploy/live" rev-parse HEAD)" == "$oldsha" ]] || fail 'failed deploy did not restore previous source'
[[ "$(cat "$deploy/live/apps/web/dist/index.html")" == old-dist ]] || fail 'failed deploy did not restore previous dist'

AB_LIVE_WORKTREE="$deploy/live" AB_LAUNCH_AGENTS_DIR="$TASK_TMP/launch-agents" tools/ab-node-service install >/dev/null
python3 - "$TASK_TMP/launch-agents/com.siso.agent-base-node.plist" <<'PY'
import plistlib,sys
p=plistlib.load(open(sys.argv[1],'rb'))
assert p['Label']=='com.siso.agent-base-node'
assert p['WorkingDirectory'].endswith('/live')
assert p['ProgramArguments'][-1]=='services/node/src/supervise.ts'
PY
echo 'PASS: conflict refused; green ship and pnpm check; supervised node version flip; probe rollback; plist generation'
