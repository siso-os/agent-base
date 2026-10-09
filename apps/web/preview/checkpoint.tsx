import React from "react";
import { createRoot } from "react-dom/client";
import { CheckpointBlock, LongPrompt } from "../src/components/CheckpointBlock";
import { TurnDivider } from "../src/components/TurnDivider";
import { splitCheckpoint } from "../src/lib/checkpoint";
import "../src/index.css";

const sample = `Status report\n1. ✅ Parser: recognizes checkpoint-shaped answers\n2. ⏳ Components: ready for ChatView integration\n3. ⛔ Preview: screenshot capture needs the WebKit runner\n**Next:** Timeline: wire these pieces into the chat view`;
const prompt = Array.from({ length: 14 }, (_, index) => `Prompt line ${index + 1}: keep the operator context readable.`).join("\n");
const checkpoint = splitCheckpoint(sample)!;

export function CheckpointPreview() {
  return <main className="checkpoint-preview" style={{ boxSizing: "border-box", maxWidth: 720, margin: "auto", padding: 20, border: "1px solid var(--crm-color-line-subtle)", borderRadius: "var(--crm-radius-card)", background: "var(--crm-color-surface)" }}>
    <h1>Assistant turn</h1>
    <CheckpointBlock checkpoint={checkpoint} />
    <TurnDivider time="2:35 PM" />
    <h2>Long user prompt</h2>
    <LongPrompt text={prompt} />
  </main>;
}

createRoot(document.getElementById("root")!).render(<CheckpointPreview />);
