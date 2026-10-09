# Checks

`pnpm check` runs these steps in order and stops on the first nonzero exit:

1. Type-check `apps/web`, `services/node`, and `services/host`.
2. Build the web app.
3. Run focused Vitest unit tests for chat formatting, minimap geometry, and agent layout/order.
4. Serve the built app, verify the Agent Base shell is present, and capture it in headless WebKit.

CI runs `pnpm check` on every push and pull request with Node 22, pnpm, and Playwright WebKit installed. It does not
run checks that attach to a herdr lab or start Claude.

The following lab checks run only with `CHECK_LAB=1`:

- `rows-survive.mjs`, `sidenav-projects.mjs`, and `tabs-hud.mjs` need the herdr lab.
- `terminal-chat.mjs` and `chat-lab.mjs` need the herdr lab and a real Claude CLI/login.
- Long-chat and manual terminal probes are intentionally not automated by `pnpm check`.

Run them locally with:

```sh
CHECK_LAB=1 heavy -- pnpm check
```

The tests use isolated lab sessions only. They must never attach to live agents because the attached view resizes the
agent terminal.
