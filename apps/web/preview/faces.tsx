import React from "react";
import { createRoot } from "react-dom/client";
import { AgentFace } from "../../../packages/halo-face";
import { faceFor } from "../src/lib/face";
import "./faces.css";

const states = [
  ["working", "working"],
  ["idle", "waiting"],
  ["needs", "needs-shaan"],
  ["failed", "blocked"],
  ["done", "done"],
  ["offline", "offline"],
] as const;
const sizes = [20, 28, 48] as const;
const fixture = { name: "ATLAS", project: "halo", status: "working" } as const;

function FacesPreview() {
  return <main className="faces-page">
    <header className="faces-header">
      <p className="faces-kicker">AGENT BASE / COMPONENT PREVIEW</p>
      <h1>Every agent has its own face.</h1>
      <p className="faces-intro">The project sets the face colour. Its expression and halo show what the agent is doing.</p>
      <div className="faces-sample"><AgentFace {...faceFor(fixture)} size={48} /><div><strong>ATLAS</strong><span>HALO · Streaming · Working</span></div><span className="faces-tag">LIVE AGENT</span></div>
    </header>
    <section className="faces-grid" aria-label="Face states at three sizes">
      <div className="faces-row faces-labels"><span>STATE</span>{sizes.map((size) => <span key={size}>{size} PX</span>)}</div>
      {states.map(([herdr, state]) => <div className="faces-row" key={state}>
        <div className="faces-state"><strong>{state.replace("-", " ")}</strong><span>herdr: {herdr}</span></div>
        {sizes.map((size) => <div className="faces-cell" key={size}><AgentFace name="ATLAS" project="halo" status={state} size={size} /></div>)}
      </div>)}
    </section>
    <footer className="faces-foot"><span>HALO FACE · 0.1.0</span><span>20 · 28 · 48 px</span></footer>
  </main>;
}

createRoot(document.getElementById("root")!).render(<FacesPreview />);
