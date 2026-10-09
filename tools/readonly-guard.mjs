// readonly-guard: make a Playwright page safe to point at the LIVE Agent Base (127.0.0.1:5401) for research screenshots.
// It blocks every terminal attach (an attached view resizes the agent's terminal for every viewer, AGENTS.md) and every
// request that changes something (anything but GET/HEAD), so a soul can walk real pages without touching a live agent.
//   import { guard } from '<repo>/tools/readonly-guard.mjs'; await guard(page);
export async function guard(page) {
  await page.routeWebSocket(/\/(term|shell)\b/, (ws) => ws.close({ code: 1000, reason: 'readonly-guard' }));
  await page.route('**/*', (route) => {
    const m = route.request().method();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS' ? route.continue() : route.abort();
  });
}
