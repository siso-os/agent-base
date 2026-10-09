// uihub: arc:notification-center
// Manual catalogue install from https://uiarc.dev/r/notification-center.json (8 Oct 2026).
// Arc panel / header / toolbar / viewSwitch / list; controlled data, SISO rows and existing focus lifecycle.
import type { ReactNode, Ref } from 'react';
import { HaloRim } from '@siso/shell';
import type { BellShelf } from '../lib/bell';
export function NotificationCenterFrame({ panelRef, header, shelf, onShelf, counts, unread, onUnread, bulk, children }: {
  panelRef: Ref<HTMLElement>; header: ReactNode; shelf: BellShelf; onShelf: (shelf: BellShelf) => void;
  counts: { needs: number; outcomes: number; later: number }; unread: boolean; onUnread: () => void; bulk: ReactNode; children: ReactNode;
}) {
  return <HaloRim className="ab-bell-rim" hue="var(--accent-tasks)" glow={false}>
    <section ref={panelRef} id="agent-notifications" role="dialog" aria-modal="false" aria-label="Notifications" data-testid="attention-panel" className="ab-attention arc-notification-center">
      {header}
      <div className="arc-notification-center__toolbar">
        <div className="arc-notification-center__view-switch" role="group" aria-label="Show notifications">
          {(['all', 'needs', 'outcomes', 'later'] as const).map(next => <button type="button" key={next} data-shelf={next} aria-pressed={shelf === next} onClick={() => onShelf(next)}>
            {next === 'all' ? 'All' : next === 'needs' ? 'Needs you' : next === 'outcomes' ? 'Outcomes' : 'Later'}
            {next !== 'all' && <span>{counts[next]}</span>}
          </button>)}
        </div>
        <div className="arc-notification-center__tools"><button type="button" aria-pressed={unread} onClick={onUnread}>Unread only</button>{bulk}</div>
      </div>
      <div className="ab-attention__scroll">{children}</div>
    </section>
  </HaloRim>;
}
