# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/JohnReySeguma/dev-flow-be/releases/tag/v0.1.0
