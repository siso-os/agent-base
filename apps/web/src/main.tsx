import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PointAndSay } from "./components/PointAndSay";
import { BrowserWindow } from "./components/browser/BrowserWindow";
import { bootModules } from "./os/modules";
import { reportBooted } from "./lib/booted";
import "./index.css";
import "./lib/doze";

// Retired in a plain browser (Shaan, 14 Oct: "one app"): a tab on the public front (5401) goes to SISO Code. The desktop
// app (Tauri) is the shell, with SISO Code as one of its modules, so it and its pop-out windows (?window=…) stay here, as
// do SISO Code's embedded nav (?embed=…) and the slot ports (5411/5412) the deploy probe loads.
const q = new URLSearchParams(location.search);
if (location.port === "5401" && !("__TAURI_INTERNALS__" in window) && !q.has("window") && !q.has("embed")) {
  location.replace(`${location.protocol}//${location.hostname}:5490/`);
}

// Boot OS modules at startup (spec §2a step 3: fetch os-modules.json, initialize registry)
void bootModules();
const isBrowserWindow = new URLSearchParams(location.search).get("window") === "browser";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The SISO Browser window (t-0439) is this app at ?window=browser: the browser alone, in a window of its own. */}
    {isBrowserWindow ? <BrowserWindow /> : <><PointAndSay /><App /></>}
  </StrictMode>,
);

// Report to the node that this page has booted, but only for the main window (not browser window)
if (!isBrowserWindow && new URLSearchParams(location.search).get("window") !== "module") {
  reportBooted();
}
