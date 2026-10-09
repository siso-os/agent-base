import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PointAndSay } from "./components/PointAndSay";
import { BrowserWindow } from "./components/browser/BrowserWindow";
import "./index.css";
import "./lib/doze";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The SISO Browser window (t-0439) is this app at ?window=browser: the browser alone, in a window of its own. */}
    {new URLSearchParams(location.search).get("window") === "browser" ? <BrowserWindow /> : <><PointAndSay /><App /></>}
  </StrictMode>,
);
