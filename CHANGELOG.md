# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/JohnReySeguma/dev-flow-be/releases/tag/v0.1.0
