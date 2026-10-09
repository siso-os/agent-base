/**
 * A real terminal: one agent's own session, attached through the laptop node.
 *
 * Lifted from the Labs fork (sisodias/siso-internal-labs, branch siso/main,
 * apps/web/core/components/siso/herdr/terminal-view.tsx). Kept: xterm.js with fit, unicode11 and WebGL; ttyd's
 * one-byte framing handled directly (addon-attach would print the framing bytes and never resize); mouse reports on
 * their own binary channel so herdr's clicks and wheel work; resize from a ResizeObserver; reconnect that rebuilds
 * the whole terminal. Changed: no mobx observer or Plane `cn`; the caller passes the socket path (Agent Base uses its
 * node's `/term/<terminal_id>/ws`) and an optional token, instead of Caddy's per-machine ttyd; the ◐ palette; and
 * the status bar is gone (the screen holds the session and nothing else), leaving an overlay while not connected.
 *
 * Part of @siso/terminal. Any server that speaks ttyd's framing works: ttyd itself, or a bridge like Agent Base's node.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/** ttyd's protocol, from its source: one command byte, then the payload. */
const CLIENT_INPUT = "0";
const CLIENT_RESIZE = "1";
const SERVER_OUTPUT = "0";
const SERVER_SET_TITLE = "1";

export function TerminalView({ socketPath, token, active = true, background = "#0a0a0a", onTitle }: {
  /** Path or absolute ws(s):// URL of a socket that speaks ttyd's framing. Changing it rebuilds the terminal. */
  socketPath: string;
  /** ttyd's AuthToken, when the server wants one. */
  token?: string;
  /** Takes the keyboard when it becomes true, so a click on its tab is enough to start typing. */
  active?: boolean;
  /** The terminal's background, to sit flush in its panel. */
  background?: string;
  onTitle?: (title: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  /**
   * Bumped to reconnect. The whole terminal is torn down and rebuilt rather than the socket being reopened under it:
   * a dead attach usually means the process behind it is gone, and reusing the screen would paste a new session on
   * top of a stale one.
   */
  const [attempt, setAttempt] = useState(0);
  const reconnect = useCallback(() => {
    setStatus("connecting");
    setAttempt((v) => v + 1);
  }, []);
  const titleRef = useRef(onTitle);
  titleRef.current = onTitle;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: { background, foreground: "#e4e4df", cursor: "#f5f4ef", selectionBackground: "rgba(255,167,38,.28)" },
    });
    // ⌘ combinations belong to the app (⌘1-9, ⌘⇧B, ⌘W, copy, paste), never to the agent: without this a shortcut can
    // still deliver its letter as typed text (seen 2 Oct: ⌘⇧B left a "b" in an agent's prompt). Paste still works,
    // because it arrives as a paste event, not a key.
    terminal.attachCustomKeyEventHandler((e) => !e.metaKey);
    // The app catches its shortcuts before xterm sees the key, and WebKit can then still insert the letter as text
    // input. Text that arrives while ⌘ is down, or within 150 ms of a ⌘ key, is dropped before xterm reads it.
    let metaAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey) metaAt = performance.now();
    };
    const onBeforeInput = (e: Event) => {
      if (performance.now() - metaAt < 150 && (e as InputEvent).inputType !== "insertFromPaste") {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    terminal.textarea?.addEventListener("beforeinput", onBeforeInput, true);
    terminal.textarea?.addEventListener("input", onBeforeInput, true);
    termRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    // Agents draw box-art and emoji; without this they measure a cell too narrow and every framed panel tears.
    const unicode = new Unicode11Addon();
    terminal.loadAddon(unicode);
    terminal.unicode.activeVersion = "11";
    terminal.open(host);
    try {
      // Agent output redraws whole screens; the canvas renderer drops frames on that. WebGL may be missing.
      const webgl = new WebglAddon();
      // A lost WebGL context leaves xterm with no renderer until the addon is disposed (it reads
      // `_renderer.value.dimensions` and throws); disposing falls back to the DOM renderer.
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      /* fall back to the default renderer */
    }

    let disposed = false;
    const fitIfShown = () => {
      // After dispose xterm's renderer is gone and fit() throws on it (a late socket open or resize).
      if (!disposed && host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    };
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const url = /^wss?:\/\//.test(socketPath) ? socketPath : `${scheme}://${window.location.host}${socketPath}`;
    const socket = new WebSocket(url, ["tty"]);
    socket.binaryType = "arraybuffer";

    socket.addEventListener("open", () => {
      if (disposed) return;
      setStatus("open");
      // Measure after layout: a flex child that has not been sized yet yields a handful of columns, and the agent
      // would draw into that instead of the full width.
      fitIfShown();
      socket.send(JSON.stringify({ AuthToken: token ?? "", columns: terminal.cols, rows: terminal.rows }));
    });
    socket.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? new TextEncoder().encode(event.data) : new Uint8Array(event.data as ArrayBuffer);
      if (disposed || data.length === 0) return;
      const command = String.fromCharCode(data[0]);
      if (command === SERVER_OUTPUT) terminal.write(data.subarray(1));
      else if (command === SERVER_SET_TITLE) titleRef.current?.(new TextDecoder().decode(data.subarray(1)));
    });
    socket.addEventListener("close", () => {
      if (disposed) return;
      setStatus("closed");
      terminal.write("\r\n\x1b[38;5;244m— disconnected —\x1b[0m\r\n");
    });

    // Every keystroke goes to the agent's terminal, so its own keys work unchanged.
    const keys = terminal.onData((chunk) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(CLIENT_INPUT + chunk);
    });
    // Clicks, drags and the wheel are mouse reports: bytes, not text, so they go as a binary frame and are never
    // re-encoded as UTF-8 on the way out.
    const mouse = terminal.onBinary((chunk) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const bytes = new Uint8Array(chunk.length + 1);
      bytes[0] = CLIENT_INPUT.charCodeAt(0);
      for (let i = 0; i < chunk.length; i++) bytes[i + 1] = chunk.charCodeAt(i) & 0xff;
      socket.send(bytes);
    });

    // The pane resizes with the window, the sidebar and the layout; a hidden tab measures 0 and is skipped until shown.
    const observer = new ResizeObserver(() => {
      if (disposed || host.clientWidth === 0 || host.clientHeight === 0) return;
      const { cols, rows } = terminal;
      fit.fit();
      if (socket.readyState === WebSocket.OPEN && (cols !== terminal.cols || rows !== terminal.rows)) {
        socket.send(CLIENT_RESIZE + JSON.stringify({ columns: terminal.cols, rows: terminal.rows }));
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKey, true);
      observer.disconnect();
      keys.dispose();
      mouse.dispose();
      socket.close();
      terminal.dispose();
      termRef.current = null;
    };
  }, [socketPath, token, attempt, background]);

  // A tab that becomes active takes the keyboard, so a click on its pill is enough to start typing.
  useEffect(() => {
    if (active && status === "open") termRef.current?.focus();
  }, [active, status]);

  return (
    <div className="relative h-full w-full" style={{ background }} data-testid="terminal" data-status={status}>
      <div ref={hostRef} className="h-full w-full px-3 py-2" />
      {status !== "open" && (
        <div className="absolute right-3 top-2 flex items-center gap-2 rounded-md border border-border bg-raised px-2 py-1 text-xs text-secondary-label">
          <span className={status === "connecting" ? "size-1.5 rounded-full bg-needs" : "size-1.5 rounded-full bg-failed"} />
          {status === "connecting" ? "connecting…" : "disconnected"}
          {status === "closed" && (
            <button type="button" onClick={reconnect} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-sidebar-row-hover">
              <RefreshCw className="size-3" />
              Reconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}
