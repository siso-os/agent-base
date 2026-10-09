import { useEffect, useRef, useState, type ComponentType, type HTMLAttributes, type ReactNode } from "react";
import "./composer.css";

export type ComposerSurfaceProps = HTMLAttributes<HTMLDivElement> & { state?: "idle" | "working" | "voice"; hue?: string; children?: ReactNode };
export type ComposerReceipt = { key: string; text?: string; label?: string };
export type ComposerFrameProps = ComposerSurfaceProps & {
  /** Supply the existing HaloRim from @siso/shell. The material is not copied or reimplemented here. */
  surface: ComponentType<ComposerSurfaceProps>;
  hud?: ReactNode;
  /** A matching accepted acknowledgement supplied by the application. Never set this on a local submit. */
  acceptedReceipt?: ComposerReceipt | null;
};

export function ComposerFrame({ surface: Surface, hud, children, acceptedReceipt, ...surfaceProps }: ComposerFrameProps) {
  const lastReceipt = useRef(acceptedReceipt?.key);
  const [receipt, setReceipt] = useState<ComposerReceipt | null>(null);
  useEffect(() => {
    if (!acceptedReceipt) { setReceipt(null); lastReceipt.current = undefined; return; }
    if (acceptedReceipt.key === lastReceipt.current) return;
    lastReceipt.current = acceptedReceipt.key;
    if (document.hidden) return;
    setReceipt(acceptedReceipt);
    const hide = () => setReceipt(null);
    const timer = window.setTimeout(hide, 2400);
    document.addEventListener("visibilitychange", hide);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", hide); };
  }, [acceptedReceipt?.key]);
  return <Surface {...surfaceProps}>
    {children}
    {hud}
    <span className="siso-chat__receipt" role="status" aria-live="polite">{receipt && <span key={receipt.key} title={receipt.text}><i aria-hidden>✓</i> {receipt.label ?? "Received"}</span>}</span>
  </Surface>;
}
