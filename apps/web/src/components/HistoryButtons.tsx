import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";

export function HistoryButtons({ canBack = true, canForward = true, onBack, onForward }: {
  canBack?: boolean;
  canForward?: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  return <div className="ab-history" aria-label="Page history">
    <button type="button" aria-label="Go back" title="Back (⌘[)" disabled={!canBack} onClick={onBack}><ArrowLeftIcon size={15} /></button>
    <button type="button" aria-label="Go forward" title="Forward (⌘])" disabled={!canForward} onClick={onForward}><ArrowRightIcon size={15} /></button>
  </div>;
}
