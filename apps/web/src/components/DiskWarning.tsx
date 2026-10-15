import { useSharedResult } from "../lib/poll";

type Servers = { servers?: { here?: boolean; health?: { diskFreeGb?: number | null } | null }[] };

/** Under this much free space on this Mac, the top bar says so (Agent Zero, 15 Oct: the disk hit 0 bytes free and
    SISO Code crashed five times before anyone saw it). */
const LOW_GB = 5;

/** One red line in the top bar while this Mac's disk is nearly full; nothing otherwise. Reads /api/servers, the poll
    the Stats page and Agent Zero's home already share. */
export function DiskWarning() {
  const servers = useSharedResult<Servers>("/api/servers", 30_000).data;
  const free = servers?.servers?.find((s) => s.here)?.health?.diskFreeGb;
  if (free == null || free >= LOW_GB) return null;
  return (
    <span role="alert" data-testid="disk-warning" className="flex-none whitespace-nowrap px-2 text-[12px] font-medium text-red-400">
      Disk nearly full: {free < 1 ? free.toFixed(1) : Math.floor(free)} GB free
    </span>
  );
}
