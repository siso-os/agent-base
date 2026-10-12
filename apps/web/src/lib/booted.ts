declare global {
  interface Window {
    __sisoBooted?: { sha: string; at: number };
    __sisoCrashes?: Array<{ name: string; message: string; at: number }>;
  }
}

export const BUILD_SHA: string = __AB_BUILD_SHA__;

let reportedBooted = false;

export function reportBooted(): void {
  if (reportedBooted) return;
  reportedBooted = true;

  // After two requestAnimationFrames, report that the page has booted
  let count = 0;
  const raf = () => {
    count++;
    if (count >= 2) {
      window.__sisoBooted = { sha: BUILD_SHA, at: Date.now() };
      fetch("/api/booted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sha: BUILD_SHA }),
      }).catch(() => {
        /* errors swallowed */
      });
    } else {
      requestAnimationFrame(raf);
    }
  };
  requestAnimationFrame(raf);
}

let crashCount = 0;
const MAX_CRASHES = 20;

export function reportCrash(name: string, message: string): void {
  if (crashCount >= MAX_CRASHES) return;
  crashCount++;

  const now = Date.now();
  window.__sisoCrashes = [
    ...(window.__sisoCrashes ?? []),
    { name, message, at: now },
  ];

  fetch("/api/booted/crash", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sha: BUILD_SHA, name, message }),
  }).catch(() => {
    /* errors swallowed */
  });
}
