# Remote enrollment and relay (t-0115 / t-0126)

The local software now includes transactional persistent enrollment/revocation/consent/replay, a durable audit ledger, authenticated outbound device reads, a private device adapter, and a dedicated private relay origin. The shipped application endpoint remains `503 remote_access_disabled`. No Cloudflare account, zone, tunnel, real identity, friend device, or live service was configured. These tasks are ready for owner security review and authorized configuration; this is not live deployment proof.

## Concrete assembly

All factories are inert with respect to networking until called explicitly. There is no environment auto-enable or default credential/path discovery.

- `createDurableRemoteEnrollment({config, stateDirectory, transport})` opens the private state database and combines the policy with the signed outbound transport. It never opens a listener or contacts a device during construction. `execute(token, body)` is the policy API; `close()` closes its database.
- `createPrivateRemoteRelay({...options, allowedOrigins})`, exported by `routes/remote-enrollment.route.ts`, creates a dedicated HTTP server without listening. Its explicit `listen(port)` method binds **only `127.0.0.1`**. The only endpoint is `POST /api/remote/access`; unrelated paths return 404. It verifies the JWT in `Cf-Access-Jwt-Assertion`, rather than trusting the header's presence. It has an explicit absolute five-second body deadline, configured Node request/header limits, and a 16-KiB header cap. `close()` closes its own connections, listener and database.
- `createDurableRemoteDevicePeer({id, tenant, hubPublicKey, privateKey, stateDirectory, readInventory})` returns `{handle, close}` without opening a listener. An authorized device process can attach `handle` to its private loopback origin. Its only operation is signed `POST /agent-base/remote/inventory`. `readInventory(signal)` supplies exactly three integer counts and must honor cancellation. An uncooperative callback retains its concurrency slot, so timed-out work cannot multiply without bound.

The deployment topology is a dedicated private hub origin behind the new Cloudflare Access application, plus each consenting device's private origin reachable through an authorized HTTPS endpoint. For devices behind NAT, a separately authorized outbound Cloudflare Tunnel can provide that endpoint without opening an inbound laptop port. The device endpoint authenticates pinned hub signatures itself; no blanket Access policy or service credential is assumed for it. The existing operator app port must not be tunneled: it serves unrelated single-operator capabilities. The new dedicated origin avoids that exposure.

A reviewed server config supplies:

```ts
const config = {
  enabled: true,
  account: 'the-reviewed-account-id',
  issuer: 'https://the-reviewed-team.cloudflareaccess.com',
  audience: 'the-reviewed-application-audience',
  keys: [{ kid: 'issuer-key-id', publicKey: issuerPublicPem }],
  principals: [
    { subject: 'verified-owner-subject', tenant: 'tenant-a', role: 'owner' },
    { subject: 'verified-support-subject', tenant: 'tenant-a', role: 'support' },
  ],
  devices: [{ id: 'device-a', ownerSubject: 'verified-owner-subject', publicKey: devicePublicPem }],
};
const relay = createPrivateRemoteRelay({
  config,
  stateDirectory: approvedPrivateDirectory, // canonical absolute path; private parent exists
  transport: {
    privateKey: hubPrivatePem,
    devices: [{ id: 'device-a', tenant: 'tenant-a', publicKey: devicePublicPem,
      url: 'https://approved-device-endpoint.example/agent-base/remote/inventory' }],
  },
  allowedOrigins: ['https://approved-app.example'],
});
// Only after account/device authorization: await relay.listen(approvedPrivatePort).
```

Private keys are supplied by the server-owned credential configuration and stay in memory; no route accepts keys, issuer configuration, paths or endpoints from a caller. Production assembly verifies that transport device IDs, tenants and public keys match the enrollment bindings. Caller-selected forwarding, shell commands and terminal controls do not exist in this protocol. Node 22.22.3's built-in `node:sqlite` and standard crypto/HTTP libraries were used; no package dependency was added.

## Identity and consent

The identity verifier uses Node RSA-SHA256 with pinned issuer keys, exact configured issuer and audience, known `kid`, valid signature, configured subject, and integer `iat`/`exp`/optional `nbf`. It refuses expired/future tokens, lifetimes over one hour, non-RS256 algorithms, token-directed key URLs, and critical extensions. Tenant/role/email claims never create authority: the server's subject binding owns tenant and role. The account label is a configuration gate, not an independent Cloudflare assertion; issuer/audience/key provisioning must be checked against that account. Pinned-key rotation or identity/device binding changes require reviewed configuration maintenance and cannot silently reuse mismatched persistent state.

This follows [Cloudflare's JWT validation guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) and [application-token format](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/). No live Cloudflare token was used in tests.

All request bodies reject unknown fields, including tenant selectors, URLs, filesystem paths and control payloads. Device IDs resolve inside the principal's server-bound tenant. An owner manages only devices bound to its exact subject. Support principals are explicitly configured in that same tenant; there is no operator-wide default access.

| Operation | Required fields besides operation/deviceId | Effect |
| --- | --- | --- |
| `enroll.issue` | none | Exact owner creates a random 256-bit, five-minute challenge. Only its hash is persisted; reissue supersedes the previous challenge. |
| `enroll.claim` | code, proof | Same owner plus the configured device's Ed25519 signature over `enrollmentProofMessage(deviceId, code)`. Consumed atomically, including across processes. |
| `device.revoke` | none | Exact owner permanently revokes this configured device identity, consumes enrollment and removes its grants. Revocation survives restart. |
| `support.grant` | subject, expiresAt, scope | Exact owner of an active device consents to `inventory.read` for a configured same-tenant support subject, at most 15 minutes and no later than the owner's JWT expiry. |
| `support.revoke` | grantId | Exact owner revokes this device's grant. |
| `relay.read` | nonce, at, proof | Active device, owner/current support consent, fresh device proof bound to this JWT digest, unused nonce, and available rate capacity. |

The exported proof functions specify versioned canonical JSON encodings. Client relay proofs have a 30-second timestamp window; nonce reservations persist for 61 seconds. The exact grant, device generation, revocation and JWT expiry are rechecked against fresh transactional state after transport returns. A replacement grant cannot revive a read authorized by a revoked grant.

## Persistent transaction and audit boundary

`openRemoteEnrollmentStore` uses `remote-access.sqlite` in an explicitly supplied canonical directory. It creates only the private leaf, requires owner UID, mode 0700 directory and 0600 regular database, rejects symlinks/hardlinks/unsafe ancestors, and checks identity/permissions before each transaction. The database is entirely separate from existing agent stores. Changed path identity, corrupt data, missing audit tables, permission drift, and configuration-fingerprint mismatch fail closed. The code never repairs, resets or silently replaces damaged state.

Enrollment, device state, consent, replay/rate reservations and audit events commit together under SQLite `BEGIN IMMEDIATE`, with a one-second busy timeout, rollback journaling, and `synchronous=EXTRA`. Crashed/uncommitted writes roll back; a competing process cannot consume the same enrollment twice. Reads after an awaited network operation reload committed state, so another process's revocation is immediately effective. Clock regression refuses authorization. SQLite's durability behavior is documented in [its PRAGMA reference](https://sqlite.org/pragma.html) and [atomic commit description](https://sqlite.org/atomiccommit.html).

The audit ledger is ordered and hash-linked to its stored head. The full chain is verified at startup and whenever another connection changes the database; the state checksum and current audit tail are checked every transaction. An audit insert/commit failure rolls back the associated state mutation. Authorized state changes, dispatch and result release are recorded in the immutable ledger. Rejected requests use separate bounded denial summaries; they never append to authorization history. Audit rows contain operation, outcome, time, verified principal/tenant/device, and grant metadata; never JWTs, enrollment codes, signatures, keys, or inventory payloads. Device peers persist replay/rate reservation plus dispatch/completion audit in their own private database.

Rejected requests are grouped into one checksummed durable summary per configured, verified subject and one anonymous bucket, at most 1,001 rows. Each summary retains first/last time, total count, the latest verified attribution, up to 16 event/reason counts and an overflow count. Raw credentials and unverified subject claims are excluded. Durable summary writes are admitted at most 60/minute per process globally and four/minute per bucket; excess observations accumulate in bounded counters and flush on an admitted interval or orderly close. An abrupt process failure can lose the unflushed aggregate, not accepted authorization history. Accounting failure sets `denialAccountingDegraded`; rejected requests remain denied, and this auxiliary failure cannot consume revocation capacity. Owner-only requests from support principals fail before taking the durable transaction lock.

Bounds are explicit: 1,000 configured devices/principals, 1,000 active grant records, 10,000 retained replay entries and a 128-MiB hard database ceiling. Ordinary authorization history stops at 100,000 rows or 96 MiB. It reserves another `configured device count + 1,000` rows and 32 MiB for revoking every device and grant that can still exist at that point. Once ordinary capacity is exhausted, no new grants or enrollments can be created; existing device/grant revocations still commit and remain auditable. Repeating an already completed device revoke is an idempotent result and consumes no further row. The accepted-history ledger is retained without eviction or automatic deletion. Disk or database failure still fails closed; reserved logical capacity is not a promise against physical disk exhaustion. Deployment operators must monitor returned capacity errors and retain a verified archive before approved state/audit maintenance. These checks protect against accidental corruption and other OS users, not a malicious process running with the same owning UID or root.

## Signed device transport

The hub makes a fresh Ed25519-signed request containing a random request ID, exact device and tenant, the fixed `inventory.read` operation, issuance time and deadline. The device verifies the pinned hub key and reserves replay/rate state before reading. Its Ed25519-signed response includes the request ID and digest, exact device/tenant, deadline, response time, and the three counts. The hub verifies all of those against the original request and the pinned device key before releasing data.

Transport URLs come only from reviewed server configuration. HTTPS certificate verification stays enabled; redirects, credentials/query/fragment in URLs, unexpected response fields, encoding, status or content type fail. A clearly named fixture option permits plain HTTP only to literal loopback IPs. There is no production TLS bypass. Each read has an absolute deadline of at most five seconds, an 8-KiB response cap, a two-request client/peer concurrency limit, and a 30-per-minute device rate limit. The hub and peer rate/replay ledgers survive restart. The peer body cap is 4 KiB; body parsing is bounded and timed-out callbacks receive an AbortSignal. A successful result contains only bounded nonnegative integer `working`, `idle`, and `blocked` counts.

The shipped application route remains disabled. The separate configured route is local-only, accepts only the selected identity-header source, rejects ambiguous credentials and unapproved browser origins, requires JSON, rejects query selectors/encoded bodies, and caps bodies at 4 KiB. The JWT is verified before parser admission. The route admits at most eight pending requests, at most two per verified subject, and at most six support requests so support traffic cannot occupy the two owner slots. An explicit five-second timer starts at admission and is never renewed by incoming bytes. Timeout, oversize, cancellation and completion remove the parser listeners/timer and release its slot; incomplete rejected requests close their owned connection. Forwarded-IP headers cannot bypass local-origin checks.

## Verification and remaining inputs

Run `heavy -- node --experimental-strip-types --no-warnings services/node/test/remote-enrollment.mjs`. The suite generates dummy identity/device keys and uses retained private fixtures, SQLite, competing Node subprocesses, and task-owned loopback servers. It exercises restart-persistent enrollment/consent/revocation/replay/rates, one-winner enrollment races, crash rollback, corrupted state/audit, cross-instance and actual-wire in-flight revocation, signed response substitution, redirects/size/deadline/concurrency/rate bounds, cancellation, self-signed TLS refusal, and the dedicated relay's Access-header route. The review regressions also send 1,100 rejected requests, verify that they consume only bounded summaries, fill the real 100,000-row immutable ledger, and then successfully revoke a grant and device with exactly two additional retained rows. HTTP regressions verify immediate refusal of an unverified partial request, a 200-ms trickle ending at the absolute deadline, global/principal/support parser limits, cancellation cleanup and an owner revoke while the six support slots are occupied. All task-owned servers/databases are closed.

Scoped compiler: `heavy -- pnpm --filter @agent-base/web exec tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --skipLibCheck --types node --typeRoots ../../services/node/node_modules/@types ../../services/node/src/routes/remote-enrollment.route.ts`.

Persistence and transport are implemented software, not outstanding account gates. Remaining external inputs are the authorized Cloudflare account/application/zone and origin URLs, verified issuer/audience/key/subject bindings, generated/provisioned real hub/device keys, approved private storage/service locations, and each friend's device enrollment/support consent. Parent adversarial review and explicit activation/deployment remain required before using those inputs. Successful external TLS routing, real Access login, installed IDE integration and real friend-device behavior remain unverified. No public listener or existing operator service was changed by this work.
