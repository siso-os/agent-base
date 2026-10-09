import { useEffect, useRef, useState } from "react";
import { MicButton } from "./MicButton";
import { onVoice } from "../lib/voice";
import { zeroCue } from "../lib/zeroFace";

/**
 * Talk to Agent Zero from any page (a0-008, his 14:47 words: "I press that and then the voice agent with the grok ...
 * works in the app And I can still click around ... I press it again and it sends the message to my agent zero").
 * The mic beside his face, or ⌘⇧Space: press, speak, press again; the words go into Agent Zero's chat as his message
 * and this page stays put. Fn itself stays SISO Voice's dictation key (WebKit never sees it, and it would fire both).
 */
export function ZeroVoice({ agentId }: { agentId: string }) {
  const [note, setNote] = useState<string | null>(null);
  const clear = useRef(0);
  const show = (text: string, ms: number) => {
    setNote(text);
    clearTimeout(clear.current);
    clear.current = window.setTimeout(() => setNote(null), ms);
  };
  useEffect(() => () => clearTimeout(clear.current), []);
  // SPEC-DELIGHT §2: his face listens while he talks (its mouth on his level), thinks while it is written down, nods
  // when it is sent, shows a problem on an error, and rests if he throws it away.
  useEffect(() => {
    let was = "idle";
    return onVoice((v) => {
      if (v.to !== "zero") return;
      if (v.error) zeroCue({ do: "problem" });
      else if (v.phase === "listening" || v.phase === "starting") zeroCue({ do: "listen", level: v.level });
      else if (v.phase === "writing") zeroCue({ do: "think" });
      else if (v.phase === "idle" && was === "listening") zeroCue({ do: "rest" });
      was = v.phase;
    });
  }, []);
  const said = async (text: string) => {
    show("Sending to Agent Zero…", 30_000);
    try {
      await sendToChat(agentId, text);
      zeroCue({ do: "done" });
      show(`Sent to Agent Zero: “${text.length > 60 ? `${text.slice(0, 60)}…` : text}”`, 5000);
    } catch (e) {
      zeroCue({ do: "problem" });
      show(`Not sent: ${(e as Error).message} You said: “${text}”`, 20_000);
    }
  };
  return (
    <div className="siso-zero-mic">
      <MicButton variant="face" to="zero" toName="Agent Zero" label="Talk to Agent Zero · ⌘⇧Space" onText={said} note={note} hotkey={(e) => e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.code === "Space"} />
    </div>
  );
}

/**
 * One message into an agent's chat without opening it: the chat's own socket (so the node types it into the pane the
 * same serialized way the box does), the prompt sent after the hello, closed once the chat shows it or 4 s pass.
 */
export function sendToChat(agentId: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/chat/${encodeURIComponent(agentId)}/ws`);
    let sent = false;
    let done = false;
    const end = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {}
      if (err) reject(err);
      else resolve();
    };
    let timer = window.setTimeout(() => end(new Error("Agent Zero's chat did not open.")), 8000);
    sock.onmessage = (m) => {
      let e: { t?: string; text?: string };
      try {
        e = JSON.parse(m.data);
      } catch {
        return;
      }
      if (e.t === "moved") return end(new Error("Agent Zero moved to another terminal; open his chat once."));
      if (!sent) {
        sent = true;
        sock.send(JSON.stringify({ t: "prompt", text, images: [] }));
        clearTimeout(timer);
        timer = window.setTimeout(() => end(), 4000);
        return;
      }
      if (e.t === "note") return end(new Error(String(e.text ?? "the chat refused it.")));
      if (e.t === "user" || e.t === "queued") end();
    };
    sock.onclose = () => end(sent ? undefined : new Error("Agent Zero's chat is not open to the app."));
  });
}
