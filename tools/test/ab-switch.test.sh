#!/bin/bash
# ab-switch end to end with real launchd (t-0539), on test labels and ports 5480-5482 only, in a scratch clone:
# deploy, switch with a prober hitting the front every 100 ms, a broken sha that must fail without touching live and
# never restart by itself, and a rollback. Nodes get a scratch HOME and a read-only herdr. Run: tools/test/ab-switch.test.sh
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/ab-switch-test.XXXXXX")
fail() { echo "FAIL: $*" >&2; exit 1; }
export AB_SWITCH_LABEL=com.siso.agent-base.test-node AB_SWITCH_FRONT_LABEL=com.siso.agent-base.test-front
export AB_SWITCH_AGENTS_DIR=$T/agents AB_SWITCH_LOGS=$T/logs AB_SWITCH_FRONT_HOME=$T/front AB_SWITCH_STATE=$T/state
export AB_SWITCH_RELEASES=$T/releases AB_SWITCH_PUBLIC_PORT=5480 AB_SWITCH_SLOTS="5481 5482" AB_SWITCH_REPO=$T/repo
export AB_SWITCH_HEALTH_S=40 AB_SWITCH_DRAIN_S=1 AB_LIVE_SKIP_RAM=1
[ -f "$ROOT/apps/web/dist/index.html" ] || fail "build the web first (pnpm --filter @agent-base/web build)"
export AB_SWITCH_BUILD="mkdir -p apps/web/dist && cp -R '$ROOT/apps/web/dist/.' apps/web/dist/"
mkdir -p "$T/home" "$T/releases"
cat > "$T/herdr" <<'H'
#!/bin/bash
case "$1 $2" in "agent list"|"pane list") exec herdr "$@";; *) exit 3;; esac
H
chmod +x "$T/herdr"
export AB_SWITCH_NODE_ENV="{\"HOME\":\"$T/home\",\"AB_HERDR\":\"$T/herdr\",\"AB_SERVERS_PROBE\":\"\",\"AB_REMOTE_INVENTORY\":\"\",\"AB_MINI_LANES\":\"\"}"
D="gui/$(id -u)"
cleanup() { for l in test-front test-node.5481 test-node.5482; do launchctl bootout "$D/com.siso.agent-base.$l" 2>/dev/null || true; done; [ -n "${PROBE:-}" ] && kill "$PROBE" 2>/dev/null || true; }
trap cleanup EXIT
git clone -q --shared "$ROOT" "$T/repo"
g() { git -C "$T/repo" "$@"; }
g config user.email t@t; g config user.name t
BASE=$(g rev-parse HEAD)
g commit -q --allow-empty -m "fixture: next"; NEXT=$(g rev-parse HEAD)
printf 'throw new Error("fixture: broken node");\n' > "$T/broken.ts"; cat "$T/repo/services/node/src/server.ts" >> "$T/broken.ts"; cp "$T/broken.ts" "$T/repo/services/node/src/server.ts"
g commit -q -am "fixture: broken"; BROKEN=$(g rev-parse HEAD)
S="$ROOT/tools/ab-switch"
"$S" install-front >/dev/null
s=$(date +%s); "$S" "$BASE" || fail "first deploy"; echo "first deploy: $(( $(date +%s)-s )) s"
curl -sf -m 5 127.0.0.1:5480/api/version | grep -q "\"sha\":\"$BASE" || fail "front does not answer with BASE"
probe() { while :; do s=$(python3 -c 'import time;print(time.time())'); if curl -sf -m 20 -o /dev/null 127.0.0.1:5480/api/version; then echo "ok $(python3 -c "import time;print(round(time.time()-$s,3))")"; else echo "FAIL"; fi; sleep 0.1; done; }
probe > "$T/probe-next.txt" & PROBE=$!
"$S" "$NEXT" || fail "switch to NEXT"
sleep 2; kill $PROBE; PROBE=''
curl -sf -m 5 127.0.0.1:5480/api/version | grep -q "\"sha\":\"$NEXT" || fail "front does not answer with NEXT"
launchctl print "$D/com.siso.agent-base.test-node.5481" >/dev/null 2>&1 && fail "old slot 5481 still loaded"
n=$(grep -c . "$T/probe-next.txt"); bad=$(grep -c FAIL "$T/probe-next.txt" || true); worst=$(awk '/^ok/{if($2>m)m=$2} END{print m+0}' "$T/probe-next.txt")
[ "$bad" = 0 ] || fail "$bad of $n requests through the front failed during the switch"
echo "PASS switch: $n requests through the front during the deploy, 0 failed, slowest ${worst} s; old slot stopped"
probe > "$T/probe-broken.txt" & PROBE=$!
if "$S" "$BROKEN" > "$T/broken.out" 2>&1; then fail "broken sha went live"; fi
sleep 8; kill $PROBE; PROBE=''
grep -q 'fixture: broken node\|exited during startup' "$T/broken.out" || { cat "$T/broken.out"; fail "failure does not say why"; }
curl -sf -m 5 127.0.0.1:5480/api/version | grep -q "\"sha\":\"$NEXT" || fail "live moved after a failed deploy"
launchctl print "$D/com.siso.agent-base.test-node.5481" >/dev/null 2>&1 && fail "broken slot still loaded 8 s later (it would retry)"
bad=$(grep -c FAIL "$T/probe-broken.txt" || true); [ "$bad" = 0 ] || fail "$bad requests failed during the broken deploy"
echo "PASS broken: '$(grep -m1 FAILED "$T/broken.out" | cut -c1-110)'; live stayed on NEXT, 0 failed requests, slot not running 8 s later"
s=$(date +%s); "$S" --rollback "$BASE" >/dev/null || fail "rollback"
curl -sf -m 5 127.0.0.1:5480/api/version | grep -q "\"sha\":\"$BASE" || fail "rollback not live"
echo "PASS rollback: BASE live again in $(( $(date +%s)-s )) s (release dir reused)"
"$S" "$BASE" | grep -q 'already live' || fail "same sha should be a no-op"
echo "PASS ab-switch end to end ($T)"
