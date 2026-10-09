import "./TurnDivider.css";

export function TurnDivider({ time }: { time: string }) {
  return <div className="turn-divider" role="separator" aria-label={`Turn at ${time}`}><span>{time}</span></div>;
}
