# Adding a page or route (from luna/ab-reg, ported 5 Oct)
1. A page: add `apps/web/src/pages/<name>.page.tsx`, call `registerPage({ id, title, icon, render })` from `./registry`.
2. `render` gets `onBack` and `backLabel`; open it with the app view `{ kind: "tab", id }`. Ids are unique (a duplicate throws).
3. `pages/load.ts` finds every `*.page.tsx` at build time. The built-in pages (Tasks, Stats, Starred, ...) keep their own flows.
4. `nav` on a page is recorded by the registry but the side nav does not list it (5 Oct: he likes the side nav as it is).
5. A node route: add `services/node/src/routes/<name>.route.ts` exporting `route = { method, path: RegExp, handle(req, res, match) }`.
6. The node loads them once at start and tries them after every built-in route, before the 404. Prefer this to growing server.ts (t-0400).
7. Checks: `services/node/test/route-registry.mjs`, `apps/web/test/page-registry.mjs`.
