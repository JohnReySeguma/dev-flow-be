# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
