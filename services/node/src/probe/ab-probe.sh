#!/bin/sh
# ab-probe: one read-only look at a machine, for the Servers page (services/node/src/servers.ts). The node pipes this file
# over ssh (`ssh <alias> sh -s`) or runs it here; nothing is installed on the far side and nothing is changed there.
# It prints sections, each opened by a line "@@ <name>"; the node turns them into JSON. Values only: no environment,
# no unit files, no keys. Every command may be missing (a Mac has no systemctl, a box no docker); a missing one prints
# nothing under its header.
export LC_ALL=C
sec() { printf '\n@@ %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

sec os; uname -s
sec host; hostname 2>/dev/null
if [ "$(uname -s)" = Linux ]; then
  sec loadavg; cat /proc/loadavg
  sec cpus; nproc 2>/dev/null
  sec mem; free -b 2>/dev/null | awk '/^Mem:/ {print $2, $7}'
  sec disk; df -B1 / 2>/dev/null | awk 'NR==2 {print $2, $4}'
  sec uptime; cut -d. -f1 /proc/uptime
  if have systemctl; then
    sec units; systemctl list-units --type=service --all --no-legend --plain --no-pager 2>/dev/null
    # When each failed unit failed (the page says "failed 3 h ago").
    failed=$(systemctl list-units --type=service --state=failed --no-legend --plain --no-pager 2>/dev/null | awk '{print $1}')
    sec failed-since
    [ -n "$failed" ] && systemctl show -p Id -p StateChangeTimestamp --no-pager $failed 2>/dev/null
    # User units for every user who lingers (their services run without a login).
    for u in $(ls /var/lib/systemd/linger 2>/dev/null); do
      uid=$(id -u "$u" 2>/dev/null) || continue
      sec "user-units $u"
      if [ "$(id -un)" = "$u" ]; then XDG_RUNTIME_DIR=/run/user/$uid systemctl --user list-units --type=service --all --no-legend --plain --no-pager 2>/dev/null
      else sudo -n -u "$u" XDG_RUNTIME_DIR=/run/user/$uid systemctl --user list-units --type=service --all --no-legend --plain --no-pager 2>/dev/null; fi
    done
  fi
  # Who listens where, and which unit owns the listener (from the process's cgroup).
  sec ports
  if have ss; then
    ss -ltnpH 2>/dev/null | while read -r _ _ _ local _ users; do
      port=${local##*:}; pid=$(echo "$users" | sed -n 's/.*pid=\([0-9]*\).*/\1/p')
      unit=""; [ -n "$pid" ] && unit=$(sed -n 's#.*/\([^/]*\.service\).*#\1#p' "/proc/$pid/cgroup" 2>/dev/null | head -n1)
      echo "$port ${local%:*} ${unit:--}"
    done
  fi
  # The Caddy map, the lines that name hosts, paths and upstreams only (never auth or headers).
  sec caddy
  [ -r /etc/caddy/Caddyfile ] && grep -E '^[[:space:]]*([^#[:space:]][^#]*\{[[:space:]]*$|reverse_proxy[[:space:]]|handle(_path)?[[:space:]]|\}[[:space:]]*$)' /etc/caddy/Caddyfile
else
  sec loadavg; sysctl -n vm.loadavg 2>/dev/null | tr -d '{}'
  sec cpus; sysctl -n hw.ncpu 2>/dev/null
  sec mem; echo "$(sysctl -n hw.memsize 2>/dev/null) $(vm_stat 2>/dev/null | awk '/page size of/ {ps=$8} /Pages (free|inactive|speculative)/ {gsub(/\./,"",$NF); n+=$NF} END {print n*ps}')"
  sec disk; df -k / 2>/dev/null | awk 'NR==2 {print $2*1024, $4*1024}'
  sec uptime; echo $(( $(date +%s) - $(sysctl -n kern.boottime 2>/dev/null | sed 's/.*sec = \([0-9]*\).*/\1/') ))
  sec launchd; launchctl list 2>/dev/null | awk '$3 ~ /^com\.siso\./'
  sec ports
  have lsof && lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {n=split($9,a,":"); print a[n], $2, $1}' | sort -u
fi
if have docker; then sec docker; docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}|{{.Ports}}|{{.Image}}' 2>/dev/null; fi
if have tailscale; then sec tailscale; tailscale ip -4 2>/dev/null | head -n1; fi
# What runs there by kind, for the agent count (a herdr list names the agents; this counts the seats herdr does not see).
sec procs; ps -eo comm= 2>/dev/null | awk '{n=split($1,a,"/"); c=a[n]} c ~ /^(claude|codex|omp|herdr)$/ {k[c]++} END {for (c in k) print c, k[c]}'
sec end
