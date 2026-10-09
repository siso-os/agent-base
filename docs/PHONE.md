# Agent Base on the phone (t-0502)

Shaan, 7 Oct 07:55: "maybe there was an agent base on my phone that'd be cool imagine if i had a phone version i could do
all of the cool shit like launch agents and chat to my agent base and launch agents from my phone". In the same breath, for
LIFE: "a mobile cloudflare url ... i downloaded a pwa on my phone". The ask asked whether the two could share a shell and
auth.

## Decisions

| Decision | Why |
|---|---|
| **Private route only: `tailscale serve` HTTPS on the laptop's tailnet name, proxying to the node's front at `127.0.0.1:5401`.** Proposed URL: `https://shaans-macbook-pro-1.tail100d11.ts.net:8443`. | Agent Base starts agents and types into their terminals, so a public URL would be a remote shell on his laptop. The tailnet is already there: the laptop serves two other tailnet-only routes, and `iphone-12` is a tailnet member (offline on 9 Oct 05:35). Tailnet membership is the login, so no auth code is needed. HTTPS comes free, and Add to Home Screen needs it. |
| **Share LIFE's shell, not its auth.** | LIFE (`personal/apps/siso-lifelock`) is Vite + React on Vercel, with Supabase auth and a Convex backend: public by design. Agent Base must not be public. They share `@siso/tokens` and `@siso/shell` (the packages in this repo) and the same PWA manifest pattern, not a login. |
| **One bundle. The phone app is the existing narrow layout (≤ 639 px, `NARROW` in App.tsx).** | It already has the nav as a sheet (PhoneSheet) and the Tasks sheet. A second app would drift. |
| **Chat only, never a terminal view, from the phone.** | An attached terminal view resizes the agent for every viewer (AGENTS.md). On a phone that would squeeze every agent to 390 px wide. The chat view reads the transcript and types through the paste+Enter queue, which is already serialised per pane (ab-130). |
| **No service worker in v1.** | iOS installs from the manifest alone. A caching worker serves a stale UI after a deploy. LIFE's own `sw.js` is a recovery worker that unregisters itself for that reason. |
| **When the laptop sleeps, the phone shows "Laptop asleep" and nothing else.** | He is "always on my laptop"; this is the just-in-case. A mini-hosted mirror is a later phase, not v1. |

## v1 scope

1. Agent Zero's chat: read, send, voice dictation. The composer is already phone-sized at 390.
2. The side nav as the home screen: owners with live dots, one tap into a chat.
3. Launch: the existing New Claude and New Codex forms (`/api/agents/start`, `/api/agents/start-codex`).
4. Tasks sheet and the bell.

## Build steps (each with its check)

1. **Node:** add the tailnet origin through `AB_ALLOWED_ORIGINS`, which already exists (server.ts:1570), in the plist env that `tools/ab-switch` writes.
   - Check: a POST and a WebSocket upgrade carrying the tailnet origin are accepted; a foreign origin still gets 403.
2. **Route:** on the laptop, `tailscale serve --bg --https=8443 http://127.0.0.1:5401`.
   - Check: `curl` over the tailnet returns the app; the same port from off-tailnet does not answer.
3. **Phone guard:** under `NARROW`, the terminal toggle is hidden and chat is forced. One sealed UI test at 390 covers it.
4. **Manifest:** check `start_url`, `scope`, icons at 180 and 512 px, and `display: standalone` against iOS.
   - Check: a 390 shot of the standalone launch.
5. **Asleep state:** when the node is unreachable, the page shows one line rather than a broken app.
   - Check: a sealed test with the API returning 502.

## Acceptance (on his phone)

1. On the iPhone (Tailscale on), open the URL, then Share → Add to Home Screen. It opens full screen.
2. Send Agent Zero a message from the phone; the reply arrives, and the laptop window shows the same chat.
3. Launch a Claude agent from the phone; it appears in the nav on both screens.
4. No agent's terminal changes size while the phone is open.

## Not in v1

- A public URL.
- Supabase or any login.
- Push notifications (these need a service worker and web push).
- The mini mirror.
