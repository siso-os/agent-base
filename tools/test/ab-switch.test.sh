#!/bin/bash
# ab-switch end to end with real launchd (t-0539), on test labels and ports $P0-$P2 only, in a scratch clone:
# deploy, switch with a prober hitting the front every 100 ms, a broken sha that must fail without touching live and
# never restart by itself, and a rollback. Nodes get a scratch HOME and a read-only herdr. Run: tools/test/ab-switch.test.sh
set -euo pipefail
# Ports: the front and two slots (AB_TEST_PORT, +1, +2); the mini already has a service on 5480.
P0=${AB_TEST_PORT:-5480}; P1=$((P0 + 1)); P2=$((P0 + 2))
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/ab-switch-test.XXXXXX")
fail() { echo "FAIL: $*" >&2; exit 1; }
export AB_SWITCH_LABEL=com.siso.agent-base.test-node AB_SWITCH_FRONT_LABEL=com.siso.agent-base.test-front
export AB_SWITCH_AGENTS_DIR=$T/agents AB_SWITCH_LOGS=$T/logs AB_SWITCH_FRONT_HOME=$T/front AB_SWITCH_STATE=$T/state
export AB_SWITCH_RELEASES=$T/releases AB_SWITCH_PUBLIC_PORT=$P0 AB_SWITCH_SLOTS="$P1 $P2" AB_SWITCH_REPO=$T/repo
export AB_SWITCH_HEALTH_S=40 AB_SWITCH_BOOT_S=20 AB_SWITCH_DRAIN_S=1 AB_LIVE_SKIP_RAM=1
[ -f "$ROOT/apps/web/dist/index.html" ] || fail "build the web first (pnpm --filter @agent-base/web build)"
# In the AB_SWITCH_BUILD, copy the dist and optionally overwrite with broken web fixture
ROOT_SHA=$(git -C "$ROOT" rev-parse HEAD)
# The copied dist was built at ROOT_SHA; stamp it with the sha being deployed, as a real build of that sha would say.
export AB_SWITCH_BUILD="mkdir -p apps/web/dist && cp -R '$ROOT/apps/web/dist/.' apps/web/dist/ && grep -rl $ROOT_SHA apps/web/dist | xargs sed -i '' \"s/$ROOT_SHA/\$(git rev-parse HEAD)/g\" && if git log -1 --format=%s | grep -q 'fixture: broken web'; then printf '%s' '<!doctype html><html><body><script>throw new Error(\"fixture: broken web\")</script></body></html>' > apps/web/dist/index.html; fi"
mkdir -p "$T/home" "$T/releases"
cat > "$T/herdr" <<'H'
#!/bin/bash
case "$1 $2" in "agent list"|"pane list") exec herdr "$@";; *) exit 3;; esac
H
chmod +x "$T/herdr"
export AB_SWITCH_NODE_ENV="{\"HOME\":\"$T/home\",\"AB_HERDR\":\"$T/herdr\",\"AB_SERVERS_PROBE\":\"\",\"AB_REMOTE_INVENTORY\":\"\",\"AB_MINI_LANES\":\"\"}"
D="gui/$(id -u)"
cleanup() { for l in test-front test-node.$P1 test-node.$P2; do launchctl bootout "$D/com.siso.agent-base.$l" 2>/dev/null || true; done; [ -n "${PROBE:-}" ] && kill "$PROBE" 2>/dev/null || true; }
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
curl -sf -m 5 127.0.0.1:$P0/api/version | grep -q "\"sha\":\"$BASE" || fail "front does not answer with BASE"
probe() { while :; do s=$(python3 -c 'import time;print(time.time())'); if curl -sf -m 20 -o /dev/null 127.0.0.1:$P0/api/version; then echo "ok $(python3 -c "import time;print(round(time.time()-$s,3))")"; else echo "FAIL"; fi; sleep 0.1; done; }
probe > "$T/probe-next.txt" & PROBE=$!
"$S" "$NEXT" || fail "switch to NEXT"
sleep 2; kill $PROBE; PROBE=''
curl -sf -m 5 127.0.0.1:$P0/api/version | grep -q "\"sha\":\"$NEXT" || fail "front does not answer with NEXT"
launchctl print "$D/com.siso.agent-base.test-node.$P1" >/dev/null 2>&1 && fail "old slot $P1 still loaded"
n=$(grep -c . "$T/probe-next.txt"); bad=$(grep -c FAIL "$T/probe-next.txt" || true); worst=$(awk '/^ok/{if($2>m)m=$2} END{print m+0}' "$T/probe-next.txt")
[ "$bad" = 0 ] || fail "$bad of $n requests through the front failed during the switch"
echo "PASS switch: $n requests through the front during the deploy, 0 failed, slowest ${worst} s; old slot stopped"

# Broken web: build succeeds but page throws before drawing
# On its own branch from NEXT (BROKEN breaks the node too); it still descends from live.
g checkout -q -b broken-web "$NEXT"; g commit -q --allow-empty -m "fixture: broken web"; BROKEN_WEB=$(g rev-parse HEAD); g checkout -q -
probe > "$T/probe-broken-web.txt" & PROBE=$!
s=$(date +%s); if "$S" "$BROKEN_WEB" > "$T/broken-web.out" 2>&1; then fail "broken web went live"; fi
sleep 8; kill $PROBE; PROBE=''
grep -q 'ROLLED BACK\|window did not boot' "$T/broken-web.out" || { cat "$T/broken-web.out"; fail "broken web failure does not say rollback"; }
curl -sf -m 5 127.0.0.1:$P0/api/version | grep -q "\"sha\":\"$NEXT" || fail "live moved after broken web"
launchctl print "$D/com.siso.agent-base.test-node.$P1" >/dev/null 2>&1 && fail "broken web slot still loaded"
bad=$(grep -c FAIL "$T/probe-broken-web.txt" || true); [ "$bad" = 0 ] || fail "$bad requests failed during broken web deploy"
echo "PASS broken web: '$(grep -m1 "ROLLED BACK" "$T/broken-web.out" | cut -c1-120)' in $(($(date +%s)-s)) s (window check ${AB_SWITCH_BOOT_S} s + build), live stayed on NEXT, 0 failed requests, candidate stopped"

probe > "$T/probe-broken.txt" & PROBE=$!
if "$S" "$BROKEN" > "$T/broken.out" 2>&1; then fail "broken sha went live"; fi
sleep 8; kill $PROBE; PROBE=''
grep -q 'fixture: broken node\|exited during startup' "$T/broken.out" || { cat "$T/broken.out"; fail "failure does not say why"; }
curl -sf -m 5 127.0.0.1:$P0/api/version | grep -q "\"sha\":\"$NEXT" || fail "live moved after a failed deploy"
launchctl print "$D/com.siso.agent-base.test-node.$P1" >/dev/null 2>&1 && fail "broken slot still loaded 8 s later (it would retry)"
bad=$(grep -c FAIL "$T/probe-broken.txt" || true); [ "$bad" = 0 ] || fail "$bad requests failed during the broken deploy"
echo "PASS broken: '$(grep -m1 FAILED "$T/broken.out" | cut -c1-110)'; live stayed on NEXT, 0 failed requests, slot not running 8 s later"
s=$(date +%s); "$S" --rollback "$BASE" >/dev/null || fail "rollback"
curl -sf -m 5 127.0.0.1:$P0/api/version | grep -q "\"sha\":\"$BASE" || fail "rollback not live"
echo "PASS rollback: BASE live again in $(( $(date +%s)-s )) s (release dir reused)"
"$S" "$BASE" | grep -q 'already live' || fail "same sha should be a no-op"
echo "PASS ab-switch end to end ($T)"
