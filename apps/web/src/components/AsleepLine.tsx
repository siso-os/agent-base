import { MoonIcon, PinIcon } from 'lucide-react';
import './AsleepLine.css';
export type SleepView = { asleepAt?: number | null; rssAtSleep?: number | null; keepAwake?: boolean; waking?: boolean; error?: string };
export const sleepClock = (at?: number | null) => at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'time not recorded';
export function AsleepLine({ sleep, onKeepAwake }: { sleep: SleepView; onKeepAwake?: () => void }) {
  return <div className="ab-asleep-line" role="status" data-testid="asleep-line" data-state={sleep.error ? 'failed' : sleep.waking ? 'waking' : 'asleep'}>
    <MoonIcon size={15} aria-hidden /><span>{sleep.error || (sleep.waking ? 'Waking…' : `Asleep since ${sleepClock(sleep.asleepAt)}. Send a message to wake it.`)}
      {!sleep.waking && !sleep.error && typeof sleep.rssAtSleep === 'number' && <small> · {Math.round(sleep.rssAtSleep)} MB released at sleep</small>}</span>
    {onKeepAwake && !sleep.waking && <button type="button" onClick={onKeepAwake}><PinIcon size={12} aria-hidden />Keep awake</button>}
  </div>;
}
