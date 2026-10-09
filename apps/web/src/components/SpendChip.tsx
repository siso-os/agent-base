import { useState } from 'react';
import { TodaySpendDial } from './TodaySpendDial';
import { useSpend } from '../lib/spend';
import { spendDialData } from '../lib/spend-dial';
import './BankChrome.css';

export function SpendChip() {
  const spend = useSpend(), data = spendDialData(spend);
  const [open, setOpen] = useState(false);
  return <div className="ab-bank-spend" data-testid="today-spend"><TodaySpendDial {...data} open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} /></div>;
}
