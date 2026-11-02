# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/JohnReySeguma/dev-flow-be/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/JohnReySeguma/dev-flow-be/releases/tag/v0.1.0
