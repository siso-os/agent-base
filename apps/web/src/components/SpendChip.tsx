import { useState } from 'react';
import { TodaySpendDial } from './TodaySpendDial';
import { useSpend } from '../lib/spend';
import { spendDialData } from '../lib/spend-dial';
import './BankChrome.css';

/** Today's fleet spend. `compact` (SISO OS §6, t-0599): smaller, in the composer's status row beside context and usage,
 * its panel opening upward. */
export function SpendChip({ compact = false }: { compact?: boolean }) {
  const spend = useSpend(), data = spendDialData(spend);
  const [open, setOpen] = useState(false);
  return <div className={`ab-bank-spend${compact ? " is-compact" : ""}`} data-testid="today-spend"><TodaySpendDial {...data} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} /></div>;
}
