# HTTP area ownership

`server.ts` owns process lifecycle, shared runtime state, request accounting, the global mutation-origin gate and outer error projection. After the gate it dispatches the explicitly composed list in `builtin.ts`, then the existing loaded routes, then the JSON 404. WebSocket upgrade/authentication, terminal/chat transports, discovery, caches and shutdown remain in the server because they share live connection and process state.

Each `*.area.ts` owns its area's HTTP parsing, method checks, status codes and response behavior. Existing service handlers remain in their leaf modules. An area receives a typed `Pick<HttpRuntime, ...>` containing only the server state and functions it uses. The import from `server.ts` is **type-only**: importing an area must never boot or import the server at runtime. Runtime getters defer values declared later in startup; the Agent Zero launch lock uses a setter to preserve the same shared lock.

## Registration and precedence

`builtin.ts` is the explicit ordered registration list. Some areas appear in several phases to retain the original precedence (for example browser diagnostics precede spaces, while browser state comes after the directory routes). Do not collapse or move these phases without a route-contract change and its tests.

The server passes its one parsed URL through the registry to each area. Existing leaf handlers therefore receive the same object, without reparsing the request at every phase. The fourth handler argument is optional for compatibility with existing three-argument routes and isolated area tests.

An explicitly wired area has `method: null`. It performs its existing method checks and returns **false only when it has not handled the request**. A response, stream, or delegated handler that has handled the request returns normally. `dispatchRoute` then stops. Existing string-method routes retain their exact method comparison and consume their match regardless of their return value.

Filename loading remains restricted to the existing `*.route.ts` contract with a string method. `*.area.ts` files are never automatically discovered; a null-method module cannot be registered through filename discovery. Existing `owners.route.ts`, `library.route.ts`, and `a0-board.route.ts` retain their ownership and registration.

## Adding or updating an endpoint

For a new endpoint in an existing area, import its leaf handler in that area's module and insert its call at the required place:

```ts
// Inside the existing area's handle(req, res), after the global server gate:
if (await handleAreaFeature(req, res, url)) return;
// Later unmatched requests reach the area's final return false.
```

Provider usage belongs in `usage.area.ts`; review capture and review delivery belong in `reviews.area.ts`. Their owners can replace or extend the existing handler calls there without reopening the server's HTTP monolith. Any origin or credential checks specific to those contracts stay before that feature's read/write. The general mutation-origin gate remains in `server.ts` before **all** area dispatch. No request path or filename confers authority.

A separately owned, exact new route can continue exporting the existing `Route` shape from a `*.route.ts` file. That runs after built-in areas and static handling, as before. A path already consumed by a built-in area must be integrated in that area instead of silently shadowed in the later registry.

## Verification

Run `heavy -- node --experimental-strip-types --no-warnings --test services/node/test/http-route-parity.mjs` for behavior parity against installed commit `25e5837c`. The test evaluates the old and current HTTP callbacks with the same isolated dependencies; it never boots the server or accesses real agents, files, credentials, application APIs or sockets. It checks statuses, headers, response bodies, dependency-call order, origin gates, method fall-through, error projection, static precedence, the launch lock, upload streams and workspace stream cleanup. Transport code after the HTTP callback is compared byte-for-byte.

Run `heavy -- node --experimental-strip-types --no-warnings services/node/test/route-registry.mjs` for loader compatibility, explicit-area fall-through and rejection of filename-loaded areas. The compiler command for this boundary is the existing Node command from `services/node/test/check.mjs`, scoped to `services/node/src/server.ts`; it includes the imported route graph without building the web app.

These are synthetic source/contract checks. Installed or live request verification remains a separate release gate. The immutable baseline test intentionally requires that commit in the repository's local Git history; future intentional endpoint changes should update their contract expectations explicitly.
