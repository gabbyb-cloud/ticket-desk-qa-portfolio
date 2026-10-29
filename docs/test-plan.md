# Ticket Desk: API contract and QA acceptance plan

Status: inherited behavior specification. Predecessor `ticket-desk-qa` local verification and hosted CI passed; this fresh copy's local tests and CI have not been executed or verified. See [verification scope](VERIFICATION.md).

## 1. Scope and architecture

Ticket Desk is a small, local, synthetic ticket application demonstrating TypeScript, Express, server-rendered accessible HTML, Playwright UI/API testing, and evidence-based CI reporting. Retain the proposed in-memory store, server-side sessions, Zod validation, and Playwright architecture. No database, external API, paid service, AI generation, or public deployment is required.

This document defines expected behavior, not a candidate test pass. See [verification scope](VERIFICATION.md) and [setup](TESTING.md).

## 2. Synthetic identities and ticket model

Each isolated application instance seeds two ordinary users: `alice@example.test` (user ID `user-alice`) and `bob@example.test` (user ID `user-bob`). Neither is an administrator. Tests may use the public, demo-only password `TicketDesk-demo-42!` for both. This password is synthetic fixture data, must never be reused for a real account, and must not be configurable from private credentials.

Seed identities at startup; begin with no tickets. Login responses never expose password hashes. A public user representation contains only `id` and `email`.

| Ticket field | Contract |
| --- | --- |
| `id` | Server-generated opaque UUID; immutable |
| `title` | String, trimmed, 1–120 Unicode code points after trimming |
| `description` | String, 0–2,000 Unicode code points; whitespace preserved |
| `status` | Exactly `open` or `closed`; created as `open` |
| `ownerId` | Taken exclusively from the authenticated session; immutable |

No timestamps, deletion, registration, password recovery, roles, or pagination in the MVP. Lists return only the caller's tickets, ordered by insertion within that instance. Tests must not depend on generated UUID values or another test's insertion order.

## 3. Routes and response contract

All application traffic is same-origin. API request and response bodies use JSON except where explicitly stated. Successful JSON responses use `{ "data": ... }`. No redirects from API endpoints. HTML forms use the browser routes below and redirect only after successful submission.

| Method | API endpoint | Input | Success | Relevant failures |
| --- | --- | --- | --- | --- |
| GET | `/api/csrf` | None | `200`, `data: { csrfToken: string }`; establishes anonymous session if needed | `500` |
| POST | `/api/auth/login` | `{ email, password }` | `200`, `data: { user: { id, email } }`; rotates session and CSRF token | `400`, `401`, `403`, `413`, `415` |
| GET | `/api/auth/me` | None | `200`, `data: { user: { id, email } }` | `401` |
| POST | `/api/auth/logout` | Empty JSON object `{}` | `204`, no body; destroys session and clears cookie | `400`, `401`, `403`, `413`, `415` |
| GET | `/api/tickets` | No query parameters | `200`, `data: Ticket[]` | `400`, `401` |
| POST | `/api/tickets` | `{ title, description }` | `201`, `data: Ticket`; `Location: /api/tickets/{id}` | `400`, `401`, `403`, `413`, `415` |
| GET | `/api/tickets/:id` | UUID path parameter | `200`, `data: Ticket` | `401`, `404` |
| PATCH | `/api/tickets/:id` | `{ status }` | `200`, `data: Ticket`; repeating current status is allowed | `400`, `401`, `403`, `404`, `413`, `415` |

Failure columns describe routine endpoint behavior; all endpoints may return sanitized `500` errors. Unsupported methods return `405` with `Allow`; unknown API routes return the JSON `404` contract. Malformed, nonexistent, and other-user ticket IDs all return the same ticket `404`. Query parameters are rejected with `400` on the list endpoint; other documented endpoints accept none and reject supplied query parameters with `400` as well.

Browser routes: `GET /login`, `POST /login`, `POST /logout`, `GET /tickets`, `GET /tickets/new`, `POST /tickets`, `GET /tickets/:id`, and `POST /tickets/:id/status`. Successful login redirects with `303` to `/tickets`; successful logout redirects with `303` to `/login`; successful ticket creation/status changes redirect with `303` to the affected detail page. Protected browser GET routes redirect anonymous users to `/login` with `303`; protected form posts return `401` if the session is absent or expired. Authenticated cross-user and nonexistent ticket detail requests return equivalent `404` pages. Form validation errors return accessible HTML with `400`; invalid login returns `401`; CSRF failures return `403`. Forms accept URL-encoded bodies only and apply the same business and ownership rules as the API. Passwords are never echoed into error pages.

### Errors and validation

API errors have exactly this envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "fields": [{ "field": "title", "code": "INVALID_VALUE" }]
  }
}
```

`fields` appears only for schema validation errors and contains field names and stable codes, never submitted values. Tests assert status, machine code, and shape rather than incidental wording, except where equivalent disclosure-safe errors are required.

| HTTP status | Error code | Meaning |
| --- | --- | --- |
| `400` | `VALIDATION_ERROR` | Wrong types, required field absent, invalid length/value, unknown fields, or unsupported query parameters |
| `400` | `MALFORMED_JSON` | JSON cannot be parsed; omit `fields` |
| `401` | `INVALID_CREDENTIALS` | Unknown email and wrong password share message `Invalid email or password.` |
| `401` | `UNAUTHENTICATED` | Missing, invalid, expired, or logged-out session |
| `403` | `CSRF_FAILED` | Missing/invalid token or untrusted request origin |
| `404` | `NOT_FOUND` | Ticket unavailable; message `Ticket not found.` for malformed, absent, and other-user IDs |
| `404` | `ROUTE_NOT_FOUND` | Unknown API route |
| `405` | `METHOD_NOT_ALLOWED` | Unsupported method on a known route |
| `413` | `PAYLOAD_TOO_LARGE` | Body exceeds 16 KiB parser limit |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | API mutation is not `application/json`, or browser form has unsupported content type |
| `500` | `INTERNAL_ERROR` | Generic message; no stack trace or internal details |

Schemas are strict. Login requires a syntactically valid email of at most 254 characters and a nonempty password of at most 128 Unicode code points. Normalize email by trimming and lowercasing; never trim passwords. Ticket creation requires both fields. Status updates require exactly `status`. Reject supplied `ownerId`, `id`, `status` on creation, and any extra update fields. All failures occur before a store write; do not silently discard invalid fields.

For known mutation routes, bound body size and enforce media type/parse validity first; then require authentication where applicable, verify CSRF, resolve ownership for a ticket target, validate the business schema, and finally commit the complete change. Thus an unauthenticated request with valid transport receives `401`, and an authenticated, CSRF-valid update of another user's ticket receives `404` regardless of business-field validity. Transport errors can precede authentication. Tests for a specific failure satisfy earlier guards. No failure response leaks submitted secrets or another user's record.

## 4. Authentication and sessions

- Use `express-session` with opaque, signed session cookies and a server-side session record. Do not put user data in a bearer token or local storage.
- Hash seed passwords with Node's maintained built-in `crypto.scrypt` implementation, using independent random salts of at least 16 bytes, a 64-byte derived key, and explicit parameters `N=131072`, `r=8`, `p=1` with adequate `maxmem` (at least 256 MiB). Store parameters and salt with the hash; compare equal-length derived keys using `crypto.timingSafeEqual`. Use the standard primitive directly; do not design encryption, a new hash, or a custom derivation algorithm. Confirm runtime support and resource cost during implementation.
- Hash once during instance seeding, never store plaintext passwords in user records, and use an equivalent dummy hash check for unknown users. Timing tests are not an MVP acceptance gate.
- Generate a fresh random session-signing secret at each application startup. No credentials or secrets from outside this project are required.
- Regenerate session ID after successful login, invalidate the prior session, and rotate the CSRF token. Fetch a fresh token or load a fresh form before the next mutation. Failed login does not authenticate the session.
- Set session cookie `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain`. Use `Secure` under HTTPS; local HTTP requires it to be disabled explicitly in demo mode. Never treat SameSite as the sole CSRF control.
- Expire sessions after 30 minutes of inactivity, enforced on the server; renew expiry on authenticated activity. Logout destroys the server record and clears the cookie with matching attributes. Replaying the old cookie must fail.
- Use `Cache-Control: no-store` for auth/token responses and authenticated pages/API data. Never log passwords, session cookies, or CSRF tokens.

The in-memory session store, localhost HTTP, restart-generated secret, public fixture accounts, and absent rate limiting are demo-only limitations. A production deployment needs HTTPS, durable shared session storage, managed secrets, login abuse controls, operational monitoring, and an independently reviewed security configuration. This plan does not authorize deployment or add those systems to the MVP.

## 5. CSRF contract for browsers and API clients

Use the synchronizer-token pattern: generate at least 32 cryptographically random bytes per session; store the token server-side. Render it into a hidden `_csrf` form field and expose it to same-origin API tests through `GET /api/csrf`. Never put it in URLs. Every mutation, including login and logout, requires the session-bound token. API clients send `X-CSRF-Token`; browser forms send `_csrf`. Strip the form's transport-only `_csrf` before strict business-schema validation. API JSON bodies must not use `_csrf` as a business field.

For all mutation routes, additionally require `Origin` to exactly match the configured application origin (scheme, hostname, port). If `Origin` is absent, require a parseable same-origin `Referer`; reject when both are absent. Reject `Origin: null`. Match parsed origins, never substring or suffix matches. Configure the origin explicitly for each test instance; do not trust arbitrary `Host` or forwarded headers to define it. API fixtures must deliberately send the configured `Origin` and valid token/cookie pair. Disable cross-origin resource sharing; do not return permissive CORS headers.

JSON content type alone is not a CSRF defense. Tokens, origin checks, media type enforcement, and cookie attributes serve separate purposes. GET routes never mutate tickets or authenticate users; the token bootstrap may establish an anonymous session only.

Negative tests independently cover missing, incorrect, another-session, and pre-login stale tokens; foreign and null origins; absent Origin with foreign Referer; neither header present; and a valid token with a hostile Origin. Verify the same-origin Referer fallback succeeds. Cover browser forms as well as JSON API mutations. A cross-origin URL-encoded attempt at an API endpoint may fail with `415` before CSRF checks; separately send valid JSON with a hostile Origin to prove the origin guard. Rejected login must not authenticate; rejected logout must leave a valid session usable; rejected ticket writes must preserve state.

## 6. Independent state and parallel execution

Each Playwright worker owns a separate application-process manager. Each application process has its own in-memory tickets, sessions, signing secret, and dynamically allocated loopback port. The worker-scoped manager starts a fresh process per test; test-scoped fixtures obtain its current base URL/origin before creating browser and request contexts. Do not use one shared mutable server for parallel workers. Each CI job likewise owns its processes.

Within a worker, execute tests sequentially and restart its application process before each test, reseeding identities and an empty ticket store. Create required tickets through that test's authenticated API context; never rely on another test. Use a new browser context and new API cookie jars per test and per synthetic user. A UI test may intentionally share its own cookie jar with its own setup API requests; Alice and Bob must remain separate. Close all contexts and terminate processes through fixture teardown, including on failure. No public reset endpoint is required.

Tests use relative relationships and captured IDs, not fixed UUIDs, sleeps, wall-clock ordering, or external services. Session-expiry tests use an injected server clock under test configuration rather than waiting 30 minutes; that configuration must not expose an HTTP clock-control endpoint. Verify equivalent results with one and two workers. The repeated-run gate uses three fresh complete runs with zero retries.

## 7. Proving rejected mutations preserve data

For each rejected ticket create/update, first read the target (if any) and the owner's full ticket list using the owner's independent authenticated context. Capture complete ticket values and sorted lists keyed by ID. Submit exactly one invalid mutation, assert its status/error contract, then repeat the owner reads and compare deep equality. For Bob's attempted write to Alice's ticket, read before/after as Alice: Bob's `404` alone does not prove integrity. For rejected creates, prove the full list is unchanged. For anonymous writes, use the legitimate owner's context for the snapshots.

Use the test's isolated instance so no unrelated write can invalidate the comparison. Validate rejected field combinations atomically: a valid `status` plus forbidden `ownerId` must reject the entire update. For rejected login/logout, compare authenticated identity/session usability as described above. Do not expose diagnostic store endpoints just for assertions.

## 8. Verification scope

The full standard API/Chromium suite is retained. Reports record acceptance IDs and named cases without raw diagnostics. Predecessor `ticket-desk-qa` local execution passed all 32 standard tests with one worker and zero retries; this fresh copy has not executed or verified those tests or hosted CI. See [verification scope](VERIFICATION.md). Specialized evidence and deliberate source-regression probes are excluded; full EVD-01 acceptance is not claimed. Browser captures, traces, video, deployment, and AI integrations are outside this candidate.
