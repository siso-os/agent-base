import {
  BadgeAlert, Bell, Brain, CheckCircle, ClipboardCheck, Coins, History,
  MessageCircleMore, Radio, Rocket, Search, Server, UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { Boundary } from "../Boundary";

const icons = {
  "badge-alert": BadgeAlert,
  bell: Bell,
  brain: Brain,
  "clipboard-check": ClipboardCheck,
  coins: Coins,
  history: History,
  "message-circle-more": MessageCircleMore,
  radio: Radio,
  rocket: Rocket,
  search: Search,
  server: Server,
  "users-round": UsersRound,
  "check-circle": CheckCircle,
} as const;

export type IconName = keyof typeof icons;
export type WidgetSize = "S" | "M" | "L";

/** One a0w-002 JSON document: one file, one shape, one renderer. */
export type WidgetFile<Shape extends string, Data> = {
  id: string;
  agent: string;
  title: string;
  shape: Shape;
  updated: string;
  data: Data;
  actions?: unknown[];
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Glyph = icons[name] ?? icons["badge-alert"];
  return <Glyph size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function WidgetCard({
  size, title, description, icon, count, metric, label, summary, tileExtra, detail, className = "", children,
}: {
  size: WidgetSize;
  title: string;
  description: string;
  icon: IconName;
  count?: ReactNode;
  metric?: ReactNode;
  label?: string;
  summary?: string;
  tileExtra?: ReactNode;
  detail?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return <section className={`siso-widget siso-widget--${size.toLowerCase()} ${className}`} aria-label={title}>
    {size === "S" ? <>
      <span className="siso-widget__tile-icon"><Icon name={icon} size={18} /></span>
      {tileExtra && <span className="siso-widget__tile-extra">{tileExtra}</span>}
      <b className="siso-widget__metric">{metric}</b>
      <span className="siso-widget__label">{label ?? title}</span>
      {summary && <p className="siso-widget__summary">{summary}</p>}
    </> : <>
      <header className="siso-widget__header">
        <span className="siso-widget__icon"><Icon name={icon} /></span>
        <div className="siso-widget__heading"><h2>{title}</h2><p>{description}</p></div>
        {count !== undefined && count !== null && <span className="siso-widget__count">{count}</span>}
      </header>
      <div className="siso-widget__body"><Boundary name={typeof title === "string" ? title : "This card"} kind="card">{children}</Boundary></div>
      {size === "L" && detail && <footer className="siso-widget__detail">{detail}</footer>}
    </>}
  </section>;
}
