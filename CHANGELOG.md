# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0-beta.3] - 2026-11-03

Invites for people who already use DevFlow, and roles per workspace end to end.

### Frontend impact

- **Can connect now:** `POST /invites/:token/join` (signed-in session, no body) adds the signed-in account to the
  inviting workspace and returns that `Workspace` with the role. `docs/INTEGRATION.md` §5.7 describes the `/invite`
  page for both cases; this is `docs/FRONTEND_BRIEF.md` Step 7.
- **Changed:** `GET /invites/:token` adds `accountExists` (sign in and join when `true`, accept when `false`) and
  `workspace.slug`.
- **BREAKING (small):** `POST /invites/:token/accept` answers `409 EMAIL_TAKEN`, not `ALREADY_MEMBER`, when the email
  already has an account. Map it to "sign in to join". `POST /workspaces/:ws/invites` now accepts emails that
  have an account elsewhere; `ALREADY_MEMBER` means a member of this workspace or already invited.
- **New error code:** `INVITE_EMAIL_MISMATCH` (403): joining while signed in with another account. The invite stays
  usable; offer to sign out and in again.

### Added

- `POST /invites/:token/join` for existing accounts. Demo accounts cannot join (`DEMO_ACCOUNT_LOCKED`).
- Accepting or joining marks the account's email verified: the emailed link proves the address.

### Changed

- Invites are refused only for members of the workspace or pending invites, not for anyone with an account.

### Handoff checklist

- [x] `docs/openapi.json` regenerated and valid
- [x] `docs/INTEGRATION.md` coverage matrix updated (join)
- [x] New error codes added to the catalogue (`INVITE_EMAIL_MISMATCH`)
- [x] New realtime events documented with examples (none in this release)
- [x] **Frontend impact** section in `CHANGELOG.md`, BREAKING changes marked
- [x] Seed and demo accounts still work on a fresh database
- [x] `docker compose up --build` instructions in the README still accurate
- [x] Known limitations or stubs listed (`docs/INTEGRATION.md` §9)

## [2.0.0-beta.2] - 2026-11-03

API v2: DevFlow is multi-workspace. Every account gets its own workspace, everything except the account lives in a
workspace under `/api/v2/workspaces/{slug}`, and `/api/v1` is removed. The frontend can start moving to v2 now
(`docs/FRONTEND_BRIEF.md` Step 4).

### Frontend impact

- **BREAKING: new prefix.** Every endpoint moves from `/api/v1` to `/api/v2`; `/api/v1` answers `404`. Set
  `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v2` and regenerate the types from the `v2.0.0-beta.2` tag.
- **BREAKING: sessions.** The cookies move to `Path=/api/v2` and `/api/v2/auth`, so everyone signs in again once.
- **BREAKING: workspace routes.** Everything that belonged to "the" workspace moves under `/workspaces/:ws` (the slug):

  | v1                                           | v2                                                                                 |
  | -------------------------------------------- | ---------------------------------------------------------------------------------- |
  | `GET /workspace`                             | `GET /workspaces/:ws`                                                              |
  | `/workspace/members…`, `/workspace/invites…` | `/workspaces/:ws/members…`, `/workspaces/:ws/invites…`                             |
  | `POST /workspace/demo/reset`                 | `POST /workspaces/:ws/demo/reset`                                                  |
  | `GET /bootstrap`                             | `GET /workspaces/:ws/bootstrap`                                                    |
  | `/projects…`, `/issues…`, `/sprints…`        | `/workspaces/:ws/projects…`, `/workspaces/:ws/issues…`, `/workspaces/:ws/sprints…` |

  A workspace you are not a member of answers `404 NOT_FOUND`, like one that does not exist.

- **BREAKING: responses.**
  - `GET /auth/me`, sign-up, sign-in and invite acceptance return `{ user, workspaces: [{ id, slug, name, role, isDemo }] }`
    instead of `{ user, workspace }`.
  - `UserProfile` has no `role` (roles are per workspace) and gains `isDemo`.
  - `Workspace` (`GET /workspaces/:ws`, `/bootstrap`) gains `slug` and `isDemo`.
  - `AccessToken` gains `workspace: { id, slug, name }`.
- **BREAKING: requests.** `POST /me/tokens` requires `workspace` (a slug you are a member of); the token works only
  there. Socket.IO moves to `/api/v2/socket.io` and `project:join` / `project:leave` take
  `{ workspace, projectKey }`; every event carries `workspaceId`.
- **BREAKING: behaviour.**
  - Sign-up (and a first OAuth sign-in) creates the account's own workspace, as admin, with a copy of the sample
    projects, instead of joining a shared workspace as member.
  - Accepting an invite joins that workspace only.
  - Removing a member ends their membership instead of deleting their account.
  - Demo reset resets the workspace's sample projects and keeps the ones people created. It works whatever
    `SEED_DEMO_DATA` says.
- **Can connect now:** the workspace switcher and "Create workspace" (`GET /workspaces`, `POST /workspaces`), rename,
  delete and leave (`PATCH`/`DELETE /workspaces/:ws`, `POST /workspaces/:ws/leave`). Details: `docs/INTEGRATION.md`
  §1.2 and §5.10.
- **New error codes:** `DEMO_WORKSPACE_LOCKED` (403), `DEMO_ACCOUNT_LOCKED` (403); OAuth error `oauth_account_locked`.
  `LAST_ADMIN` is now also returned by leave.
- **Not yet:** inviting someone who already has an account (`beta.3`), email verification (`beta.4`), GitHub per
  workspace (`beta.5`; deliveries apply to the demo workspace until then).

### Added

- `GET /workspaces`, `POST /workspaces { name, sampleData }`, `PATCH`/`DELETE /workspaces/:ws` and
  `POST /workspaces/:ws/leave`.
- Sample data: new workspaces start with a copy of DEV, BIL and MOB (the demo admin's issues assigned to the creator,
  the rest unassigned, no comments); copies are flagged `is_sample`.
- The demo workspace and the five demo accounts are locked against changes every visitor would see (rename, delete,
  leave, invites and member changes; profile, tokens, new workspaces, password reset and OAuth takeover).
- `npm run demo:reset` (`node dist/src/jobs/demo-reset.js` in the image) restores the demo workspace, for a nightly
  cron on a public deployment (`docs/DEPLOYMENT.md` §5.1).

### Changed

- The OAuth callbacks (`/api/auth/oauth/{provider}/callback`) and the GitHub webhook
  (`/api/integrations/github/webhook`) are version-free, so future API versions never require reconfiguring GitHub
  or Google. **Update the registered URLs** (README, GitHub integration; `docs/DEPLOYMENT.md` §2).
- Every request under `/workspaces/:ws` resolves the caller's membership once; services act in that workspace with
  the caller's role there.

### Removed

- `/api/v1`.

### Migration

- `20261103020000_sample_projects` adds `projects.is_sample` and marks DEV, BIL and MOB in the demo workspace.
- `20261103030000_demo_accounts` adds `users.is_demo` and marks the five demo accounts that are members of the demo
  workspace.

### Handoff checklist

- [x] `docs/openapi.json` regenerated and valid
- [x] `docs/INTEGRATION.md` coverage matrix updated (every path, the workspace endpoints)
- [x] New error codes added to the catalogue (`DEMO_WORKSPACE_LOCKED`, `DEMO_ACCOUNT_LOCKED`, `oauth_account_locked`)
- [x] New realtime events documented with examples (no new events; the join payload and `workspaceId` changed)
- [x] **Frontend impact** section in `CHANGELOG.md`, BREAKING changes marked
- [x] Seed and demo accounts still work on a fresh database, and on one migrated from `beta.1`
- [x] `docker compose up --build` instructions in the README still accurate
- [x] Known limitations or stubs listed (`docs/INTEGRATION.md` §9)

## [2.0.0-beta.1] - 2026-11-03

First step towards multiple workspaces (API v2): the data model. A user can now belong to several workspaces with a
different role in each. The `/api/v1` contract is unchanged in this pre-release; `beta.2` moves everything to
`/api/v2`.

### Frontend impact

- None. No endpoint, response or error changed.
- **Coming in `beta.2` (BREAKING):** every path moves to `/api/v2`, workspace routes move under `/workspaces/:slug`,
  and `/api/v1` is removed. Plan the switch then, not now.

### Added

- `workspace_members`: roles live on the membership, so one person can be admin in one workspace and viewer in
  another.
- Workspaces have a URL slug (`acme-inc`), set at creation and unchanged by renames, and an `is_demo` flag for the
  seeded Acme Inc.
- Users record when their email was verified (used from `beta.4`).

### Changed

- Access tokens are bound to the workspace they were created in, and stop working once their owner leaves it.

### Migration

- `20261103010000_workspace_memberships` runs on start (`migrate deploy`). Each user becomes a member of the workspace
  they were in, with the same role; each token is bound to its owner's workspace; the workspace containing
  `demo@devflow.local` is marked as the demo; existing accounts count as verified, because v1 never asked anyone to
  verify. Back up the database before upgrading a deployment you care about: the migration drops `users.workspace_id`
  and `users.role`.

### Handoff checklist

- [x] `docs/openapi.json` regenerated and valid (unchanged)
- [x] `docs/INTEGRATION.md` coverage matrix updated (no endpoint changes; a note that v2 is in progress)
- [x] New error codes added to the catalogue (none in this release)
- [x] New realtime events documented with examples (none in this release)
- [x] **Frontend impact** section in `CHANGELOG.md`
- [x] Seed and demo accounts still work on a fresh database, and on a migrated one
- [x] `docker compose up --build` instructions in the README still accurate
- [x] Known limitations or stubs listed (`docs/INTEGRATION.md` §9, unchanged)

## [1.0.1] - 2026-11-02

### Frontend impact

- None.

### Removed

- The unused `@octokit/app` and `@octokit/rest` dependencies: webhooks need only an HMAC check, so the image is
  smaller and carries less third-party code.

## [1.0.0] - 2026-11-02

Hardening: rate limits, fixes from a security review, deployment notes. The API contract is now stable: breaking
changes from here on need a new `/api/v2` prefix.

### Frontend impact

- **Can connect now:** `429 RATE_LIMITED` handling (details in `docs/INTEGRATION.md` §4.1). Show the wait from
  `Retry-After`, keep form input, don't auto-retry; a `429` from `/auth/refresh` means "later", not "signed out".
- **Now readable cross-origin:** `ETag` (so `If-Match` finally works from the browser), `X-Request-Id`, `Retry-After`,
  `RateLimit`, `RateLimit-Policy`.
- **Behaviour:**
  - A password reset also deletes the account's access tokens; mention it on the success screen (§5.6).
  - OAuth claiming an account first registered with a password removes that password and revokes its sessions and
    tokens (§5.5).
  - Access tokens need `issues:read` for `GET /workspace` and `GET /workspace/members`.
- **New error code:** none. Now returned: `RATE_LIMITED` (429).
- **BREAKING:** none for the frontend. For operators, `NODE_ENV=production` now requires `SEED_DEMO_DATA` and
  `EMAIL_PROVIDER` to be set (`docker-compose.yml` sets them).

### Added

- Rate limits (`express-rate-limit`, Redis store when `REDIS_URL` is set) on every request, with tighter limits on
  sign-in (per IP and email, failures only), sign-up, password reset, OAuth, refresh, invites, invite links and GitHub
  deliveries; `429` documented on every limited operation in the OpenAPI document.
- `TRUST_PROXY` for deployments behind a proxy or load balancer.
- `docs/DEPLOYMENT.md`: production configuration, network, health and shutdown, and a security checklist.

### Fixed

- A malformed session cookie on a Socket.IO handshake crashed the process.
- `GET /auth/oauth/constructor` (and other prototype names) answered 500 instead of 404.
- CORS did not expose `ETag` or `X-Request-Id`, so the frontend could not read them.
- Tokens without `issues:read` could list the workspace's members and invites.
- A password reset left access tokens working.
- OAuth sign-in linked to an account someone else had registered with the same, unverified, email.
- `CORS_ORIGIN` or `API_URL` with a trailing slash broke writes, sockets and redirects.
- Production could start with the demo seed and logged emails by default.
- `docker-compose.yml` published PostgreSQL and Redis on every interface; now on `127.0.0.1` only.

### Security

- Reviewed the authentication, authorization, CSRF, OAuth, webhook, Socket.IO, logging and Docker setup; the findings
  are fixed above, and the remaining trade-offs are listed in `docs/INTEGRATION.md` §9.
- `npm audit --omit=dev`: no known vulnerabilities.

### Handoff checklist

- [x] `docs/openapi.json` regenerated and valid
- [x] `docs/INTEGRATION.md` coverage matrix updated (no new endpoints; rate limits in §4.1)
- [x] New error codes added to the catalogue (none; `RATE_LIMITED` is now returned)
- [x] New realtime events documented with examples (none in this release)
- [x] **Frontend impact** section in `CHANGELOG.md`
- [x] Seed and demo accounts still work on a fresh database
- [x] `docker compose up --build` instructions in the README still accurate
- [x] Known limitations or stubs listed (`docs/INTEGRATION.md` §9)

## [0.6.0] - 2026-11-02

Live Sync over Socket.IO and the GitHub integration.

### Frontend impact

- **Can connect now** (details in `docs/INTEGRATION.md` §7): Live Sync.
  - Connect with `io("<API>/realtime", { path: "/api/v1/socket.io", withCredentials: true })`; on `connect_error`
    with `err.data.code === "TOKEN_EXPIRED"`, refresh once and reconnect.
  - `project:join` / `project:leave` with an ack; re-join and re-fetch the snapshot after every reconnect.
  - Events: `issue.created|updated|moved|deleted`, `sprint.created|updated|started|completed|deleted`,
    `workflow.updated`, `project.updated|deleted`, `presence.updated`. Every payload has `projectKey` and `actorId`;
    ignore your own `actorId`. Payloads carry the REST shapes, so the store can apply them directly.
  - `presence.updated { online: userId[] }` drives online avatars per project.
- **Behaviour:** `Issue.git` is now set by GitHub (PR or commit badge); a merged PR moves its issue to Done. Such
  changes arrive with `actorId: null`. Shown only when `GET /config` reports `githubIntegration: true`.
- **New error code:** `WEBHOOK_SIGNATURE_INVALID` (401), returned only to GitHub.
- **BREAKING:** none. `UserProfile` gets no `presence` field: online status comes from `presence.updated`.

### Added

- Socket.IO server at `/api/v1/socket.io`, namespace `/realtime`: cookie or access-token handshake with an Origin
  check, project rooms, presence, and the Redis adapter for multiple API instances (in-memory without Redis).
- Live Sync events for issues (including comment counts), sprints, workflows and projects, published after each change
  commits; `issue.moved` says where the issue now ranks (`beforeIssueKey`).
- `POST /integrations/github/webhook`: verifies `X-Hub-Signature-256` over the raw body, reads issue keys from PR
  titles, branch names and commit messages, links pull requests and commits to issues, and moves issues to Done when
  their pull request is merged.

### Changed

- Services are built once in a composition root (`src/services.ts`) shared by the HTTP routes and the realtime server.
- Shutdown closes the realtime server before the HTTP server.

### Handoff checklist

- [x] `docs/openapi.json` regenerated and valid
- [x] `docs/INTEGRATION.md` coverage matrix updated: Live Sync, presence and the `Issue.git` badge
- [x] New error codes added to the catalogue (`WEBHOOK_SIGNATURE_INVALID`)
- [x] New realtime events documented with examples (§7.3)
- [x] **Frontend impact** section in `CHANGELOG.md`
- [x] Seed and demo accounts still work on a fresh database
- [x] `docker compose up --build` instructions in the README still accurate
- [x] Known limitations or stubs listed (`docs/INTEGRATION.md` §9)

## [0.5.0] - 2026-11-02

Sprint lifecycle and reports.

### Frontend impact

- **Can connect now** (details in `docs/INTEGRATION.md` §6.5 and §6.6): the remaining `lib/tracker/store.ts` functions
  and the reports page.
  - `createSprint` → `POST /projects/:key/sprints`; `updateSprint` → `PATCH /sprints/:id`; `deleteSprint` →
    `DELETE /sprints/:id` (planned only).
  - `startSprint` → `POST /sprints/:id/start { name, goal, durationDays }`.
  - `completeSprint` → `POST /sprints/:id/complete { carryOver }`, answering `{ sprint, carriedOverTo }`.
  - Reports page: `GET /sprints/:id/burndown` (the same `BurndownDay[]` the view builds today),
    `GET /projects/:key/reports/velocity` and `.../history`.
- **Behaviour:** one active sprint per project; burndown now comes from the issue history, so mid-sprint scope,
  estimate and status changes are counted correctly.
- **New error code:** `SPRINT_NOT_ACTIVE` (409). Now returned: `SPRINT_ALREADY_ACTIVE`, `SPRINT_NOT_PLANNED`.
- **BREAKING:** none.

### Added

- Sprint list (with status filter), create (`Sprint {n+1}`), rename, and delete (planned only, issues return to the
  backlog).
- Start (one active sprint per project, enforced under a project lock; committed points snapshotted) and complete (report,
  carry-over to the backlog, a planned sprint or a new sprint, in one transaction).
- Burndown from `issue_events`, velocity and sprint history.

### Changed

- The demo's active-sprint issues join their sprint at its start, so the demo burndown starts at the committed points.
- The integration test setup explains an unreachable test database instead of crashing at startup.

### Handoff checklist

- [x] `docs/openapi.json` regenerated and valid
- [x] `docs/INTEGRATION.md` coverage matrix updated: every `store.ts` function and the reports page are now served
- [x] New error codes added to the catalogue (`SPRINT_NOT_ACTIVE`)
- [x] New realtime events documented with examples (none in this release)
- [x] **Frontend impact** section in `CHANGELOG.md`
- [x] Seed and demo accounts still work on a fresh database
- [x] `docker compose up --build` instructions in the README still accurate
- [x] Known limitations or stubs listed (`docs/INTEGRATION.md` §9)

## [0.4.0] - 2026-11-02

Projects, workflow statuses, issues with ranking and comments, bootstrap and snapshots, and the demo tracker.

### Frontend impact

- **Can connect now** (details in `docs/INTEGRATION.md` §6): every `lib/tracker/store.ts` function except the sprint
  ones.
  - Load with `GET /bootstrap` and `GET /projects/:key/snapshot` instead of the seed.
  - Projects: `GET`/`POST /projects`, `GET`/`PATCH`/`DELETE /projects/:key`; `GET /projects` adds each project's
    active-sprint progress, backlog count and lead.
  - Issues: `POST /projects/:key/issues`, `GET`/`PATCH`/`DELETE /issues/:issueKey`, and
    `POST /issues/:issueKey/move` for board drops and backlog ranking.
  - Workflow: `POST /projects/:key/statuses`, `PATCH`/`DELETE …/:id` and `PUT …/order` (send the full order).
  - Comments: `GET`/`POST /issues/:issueKey/comments`.
  - `POST /workspace/demo/reset` for "Reset demo data".
- **Shapes:** `Issue.id` is the key (`DEV-104`); every other id is a UUID; keys are never zero-padded (`DEV-88`, not
  `DEV-088`). `resolvedAt` is managed by the API. Workflow changes answer with the whole `Project`.
- **Permissions:** viewers read only; members edit issues and create projects; admins edit workflows, delete projects
  and reset demo data. Access tokens need `issues:read`, `issues:write` or `projects:admin`.
- **New error code:** `STATUS_UPDATE_BLOCKED` (409). Now returned: `PROJECT_KEY_TAKEN`, `STATUS_DELETE_BLOCKED`.
- **Not yet:** sprint create, edit, start and complete, and the reports (`v0.5.0`); realtime (`v0.6.0`).
- **BREAKING:** none.

### Added

- Projects with a default workflow, immutable keys, colours assigned in turn and If-Match concurrency.
- Workflow statuses: add, rename, recategorise, reorder and delete, with the frontend's guards, under a project lock.
- Issues keyed by an atomic per-project counter, with defaults, reference checks, server-managed `resolvedAt`, key
  lookup (including `?project=` for bare numbers), filters and If-Match.
- Fractional-index ranking (byte-ordered `COLLATE "C"` column) and a move endpoint that never renumbers other issues.
- Issue comments with a denormalised count.
- Issue history (`issue_events`) for status, sprint and estimate changes, ready for burndown in `v0.5.0`.
- Sprints table, served read-only in snapshots.
- `GET /bootstrap`, `GET /projects/:key/snapshot` and project summaries.
- The frontend's demo tracker in the seed (DEV, BIL, MOB) and `POST /workspace/demo/reset`.

### Handoff checklist

- [x] `docs/openapi.json` regenerated and valid
- [x] `docs/INTEGRATION.md` coverage matrix updated
- [x] New error codes added to the catalogue (`STATUS_UPDATE_BLOCKED`)
- [x] New realtime events documented with examples (none in this release)
- [x] **Frontend impact** section in `CHANGELOG.md`
- [x] Seed and demo accounts still work on a fresh database (now including DEV, BIL and MOB)
- [x] `docker compose up --build` instructions in the README still accurate
- [x] Known limitations or stubs listed (`docs/INTEGRATION.md` §9)

## [0.3.0] - 2026-11-02

Workspace: members, roles, invites and permission middleware.

### Frontend impact

- **Can connect now** (details in `docs/INTEGRATION.md` §5.7 and §5.9):
  - Team members page: `GET /workspace/members` returns active members and pending invites in the existing
    `TeamMember` shape; `GET /workspace` returns the workspace name and your role.
  - Invite and resend: `POST /workspace/invites`, `POST /workspace/invites/:id/resend`.
  - Change role: `PATCH /workspace/members/:id`; remove a member or revoke an invite: `DELETE /workspace/members/:id`.
  - New `/invite?token=…` page: `GET /invites/:token` to preview, `POST /invites/:token/accept` to create the account
    and sign in.
- **Behaviour to adapt:** removing a member is immediate and permanent, so the current "Undo" needs to become a
  confirmation (or a delayed request). Show `EMAIL_DELIVERY_FAILED` instead of "Invite sent" when it occurs.
- **Permissions:** viewers and members get `403 FORBIDDEN` on member management; hide those controls by role.
- **New error codes:** `INVITE_INVALID` (400), `CANNOT_REMOVE_SELF` (403), `EMAIL_DELIVERY_FAILED` (502). Now
  returned: `CANNOT_CHANGE_OWN_ROLE`, `LAST_ADMIN`, `ALREADY_MEMBER`.
- **Not in this release:** `POST /workspace/demo/reset` moves to `v0.4.0`, together with the demo projects it restores.
- **BREAKING:** none.

### Added

- `GET /workspace` and `GET /workspace/members` (members and pending invites in one paginated list).
- Role changes and member removal for admins, with the own-role, self-removal and last-admin rules; the admin rows are
  locked so concurrent demotions cannot leave the workspace without an admin.
- Email invites with seven-day, single-use links, resend with token rotation, invite preview and acceptance.
- Role and scope guards (`requireRole`, `requireScope`) for every module to use.

### Security

- Invite tokens, OAuth `code`/`state` and `token` query parameters are redacted from request logs.

### Handoff checklist

- [x] `docs/openapi.json` regenerated and valid
- [x] `docs/INTEGRATION.md` coverage matrix updated
- [x] New error codes added to the catalogue (`INVITE_INVALID`, `CANNOT_REMOVE_SELF`, `EMAIL_DELIVERY_FAILED`)
- [x] New realtime events documented with examples (none in this release)
- [x] **Frontend impact** section in `CHANGELOG.md`
- [x] Seed and demo accounts still work on a fresh database
- [x] `docker compose up --build` instructions in the README still accurate
- [x] Known limitations or stubs listed (`docs/INTEGRATION.md` §8)

## [0.2.1] - 2026-11-02

### Frontend impact

- No endpoint changes. The OpenAPI examples for passwords, reset tokens and access-token secrets are now placeholders
  (`YOUR_PASSWORD`, `RESET_TOKEN_FROM_EMAIL`, `dfp_YOUR_ACCESS_TOKEN`); regenerate types from this tag if you copy
  examples.
- Realtime will be served at `/api/v1/socket.io` (from `v0.6.0`), next to the `/api/v1`-scoped session cookie.
- **BREAKING:** none.

### Fixed

- Credential examples in `docs/openapi.json` looked like real secrets and triggered secret-scanner warnings. No real
  credential was ever committed.

### Handoff checklist

- [x] `docs/openapi.json` regenerated and valid
- [x] `docs/INTEGRATION.md` coverage matrix updated (unchanged)
- [x] New error codes added to the catalogue (none)
- [x] New realtime events documented with examples (none; endpoint path documented)
- [x] **Frontend impact** section in `CHANGELOG.md`
- [x] Seed and demo accounts still work on a fresh database
- [x] `docker compose up --build` instructions in the README still accurate
- [x] Known limitations or stubs listed (unchanged)

## [0.2.0] - 2026-11-02

Authentication: accounts, sessions, OAuth, password reset, profile and personal access tokens.

### Frontend impact

- **Can connect now** (details in `docs/INTEGRATION.md` §5):
  - Session check on app load: `GET /api/v1/auth/me` (`401 UNAUTHENTICATED` → `/login`).
  - Sign in / sign up: `POST /auth/login`, `POST /auth/signup`; log out: `POST /auth/logout`.
  - Token renewal: on `401 TOKEN_EXPIRED` call `POST /auth/refresh` once and retry. **Run only one refresh at a
    time**: reusing a refresh token revokes the session.
  - GitHub / Google buttons: navigate the browser to `/api/v1/auth/oauth/{github,google}?redirect=/projects`; failures
    land on `/login?error=oauth_denied|oauth_state_mismatch|oauth_email_unverified|oauth_failed`.
  - Forgot password: `POST /auth/password/forgot`; new page `/reset-password?token=…` calls `POST /auth/password/reset`.
  - Profile page: `GET /me` and `PATCH /me` (optional `If-Match` → `412 CONFLICT_STALE`).
  - Access tokens page: `GET /me/tokens`, `POST /me/tokens` (secret shown once), `DELETE /me/tokens/:id`.
- **Requests:** send `credentials: "include"` everywhere; cookies are HttpOnly and managed by the API. Writes must come
  from `CORS_ORIGIN` (the browser's `Origin` header), otherwise `403 FORBIDDEN`.
- **Shapes:** `UserProfile` uses the frontend's `gradient` field and has no `presence` yet; ids are UUIDs
  (`docs/INTEGRATION.md` §1.1).
- **New error code:** `RESET_TOKEN_INVALID` (400). Now returned: `UNAUTHENTICATED`, `TOKEN_EXPIRED`,
  `INVALID_CREDENTIALS`, `FORBIDDEN`, `EMAIL_TAKEN`, `CONFLICT_STALE`, `VALIDATION_FAILED`.
- **Demo accounts:** `demo@`, `member@` and `viewer@devflow.local`, password `devflow-demo`.
- **BREAKING:** none.

### Added

- Sign-up, login, logout and `GET /auth/me`; Argon2id passwords; the first user of an empty workspace becomes admin,
  later sign-ups join as members.
- Sessions with a 15-minute access JWT and a rotating refresh token in HttpOnly, Secure, SameSite=Lax cookies;
  reuse of a refresh token revokes the session; 30-day absolute session lifetime.
- Origin check on cookie-authenticated writes (CSRF protection).
- GitHub and Google sign-in with state and PKCE; accounts are linked by provider id or verified email.
- Password reset by email with single-use, one-hour links; a reset signs out every session.
- Console and SMTP email providers.
- `GET /me` and `PATCH /me` with ETag / If-Match optimistic concurrency.
- Personal access tokens (`dfp_…`, hashed at rest) with `Authorization: Bearer` authentication and keyset pagination.
- Demo accounts for each role, plus the frontend's team and example tokens, in the seed.
- `API_URL` environment variable for OAuth callback URLs.

### Fixed

- The server exits with a clear message instead of a stack trace when its port is already in use.

### Handoff checklist

- [x] `docs/openapi.json` regenerated and valid
- [x] `docs/INTEGRATION.md` coverage matrix updated
- [x] New error codes added to the catalogue (`RESET_TOKEN_INVALID`)
- [x] New realtime events documented with examples (none in this release)
- [x] **Frontend impact** section in `CHANGELOG.md`
- [x] Seed and demo accounts still work on a fresh database
- [x] `docker compose up --build` instructions in the README still accurate
- [x] Known limitations or stubs listed (`docs/INTEGRATION.md` §8: roles not enforced yet, no rate limits yet)

## [0.1.0] - 2026-11-02

Foundation: configuration, database, error format, health checks, feature flags, OpenAPI, Docker and CI.

### Frontend impact

- **Can connect now:** `GET /api/v1/config` → `{ oauth: { github, google }, githubIntegration, email }` to hide
  sign-in buttons and integrations that are not configured (see `docs/INTEGRATION.md` §3).
- **Error handling:** every error is `application/problem+json`; switch on `code`. The full catalogue is in
  `docs/INTEGRATION.md` §4, with codes not yet returned marked as reserved.
- **Types:** generate from `docs/openapi.json` (OpenAPI 3.1); schemas `PublicConfig`, `ProblemDetails`, `Liveness`,
  `Readiness`.
- **BREAKING:** none (first release).
- **Not yet available:** authentication, data endpoints, `/bootstrap`, realtime. Keep using the local store.

### Added

- Project foundation: strict TypeScript (native ESM), ESLint, Prettier, Vitest and Supertest.
- Zod-validated environment that fails fast with a clear message; optional integrations disable themselves when
  their variables are empty, and the active modes are logged at startup.
- Structured JSON logging with pino and an `X-Request-Id` on every request.
- RFC 9457 `application/problem+json` errors with a stable error-code catalogue, and Zod request validation.
- PostgreSQL 16 with Prisma 7: initial migration (`workspaces`) and an idempotent seed.
- `GET /api/v1/health` (liveness) and `GET /api/v1/health/ready` (database and Redis readiness).
- `GET /api/v1/config` feature flags for the frontend.
- OpenAPI 3.1 spec generated from the Zod schemas: `docs/openapi.json`, `/api/v1/openapi.json`, Swagger UI at
  `/api/v1/docs`.
- Multi-stage Dockerfile (non-root, health check, migrate and seed on start) and a Compose stack with Postgres and
  Redis.
- GitHub Actions CI: checks against Postgres and Redis service containers, plus a Docker image build.

### Handoff checklist

- [x] `docs/openapi.json` regenerated and valid
- [x] `docs/INTEGRATION.md` coverage matrix updated
- [x] New error codes added to the catalogue (all 19 codes, minimum set included)
- [x] New realtime events documented with examples (none in this release)
- [x] **Frontend impact** section in `CHANGELOG.md`
- [x] Seed and demo accounts still work on a fresh database (seed verified; demo accounts arrive with auth in
      `v0.2.0`)
- [x] `docker compose up --build` instructions in the README still accurate
- [x] Known limitations or stubs listed (`docs/INTEGRATION.md` §8)

[Unreleased]: https://github.com/JohnReySeguma/dev-flow-be/compare/v2.0.0-beta.3...HEAD
[2.0.0-beta.3]: https://github.com/JohnReySeguma/dev-flow-be/compare/v2.0.0-beta.2...v2.0.0-beta.3
[2.0.0-beta.2]: https://github.com/JohnReySeguma/dev-flow-be/compare/v2.0.0-beta.1...v2.0.0-beta.2
[2.0.0-beta.1]: https://github.com/JohnReySeguma/dev-flow-be/compare/v1.0.1...v2.0.0-beta.1
[1.0.1]: https://github.com/JohnReySeguma/dev-flow-be/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.6.0...v1.0.0
[0.6.0]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/JohnReySeguma/dev-flow-be/releases/tag/v0.1.0
