# DevFlow API

REST + realtime API for [DevFlow](https://github.com/JohnReySeguma/dev-flow), a sprint-based issue tracker:
projects with custom workflows, backlogs, sprints, reports, GitHub integration and Live Sync.

> **Status:** `v2.0.0` — API v2 is multi-workspace: every account gets its own workspace and can belong to
> others with a different role in each. Authentication, workspaces (members, roles, invites), the tracker (projects,
> workflows, issues with ranking and comments, the sprint lifecycle and reports), Live Sync over Socket.IO, GitHub
> webhooks, and hardening (rate limits, a security review). Deploying it: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
> Frontend integration: the contract is [`docs/INTEGRATION.md`](docs/INTEGRATION.md); the step-by-step plan is
> [`docs/FRONTEND_BRIEF.md`](docs/FRONTEND_BRIEF.md).

## Stack

| Concern    | Choice                                                          |
| ---------- | --------------------------------------------------------------- |
| Runtime    | Node.js 22, TypeScript (strict, native ESM)                     |
| HTTP       | Express 5, helmet, cors, cookie-parser                          |
| Validation | Zod 4 — also the source of the OpenAPI 3.1 spec                 |
| Database   | PostgreSQL 16 via Prisma 7 (node-postgres driver adapter)       |
| Cache      | Redis 7 via ioredis — optional, in-memory fallback when unset   |
| Realtime   | Socket.IO 4 with the Redis adapter (multi-instance fan-out)     |
| Logging    | pino (JSON lines on stdout)                                     |
| Tests      | Vitest + Supertest against a real Postgres test database        |
| Tooling    | ESLint (type-aware typescript-eslint), Prettier, GitHub Actions |

TypeScript is pinned to 6.0: TypeScript 7 no longer ships the compiler API that typescript-eslint needs.

The brief lists `@octokit/app` and `@octokit/rest` for GitHub; they are not installed. DevFlow only receives GitHub
webhooks, which need an HMAC check (`node:crypto`), not an API client. Add them back if DevFlow starts calling GitHub.

## Run locally

Only **Docker Desktop** and **Node.js 22** are needed. Postgres and Redis run in containers; the API runs on the host
so code changes reload instantly.

```bash
cp .env.example .env          # then set JWT_SECRET (see below)
npm install
npm run db:up                 # postgres + redis in Docker, waits until healthy
npm run db:migrate            # apply migrations to the dev database
npm run db:seed               # demo data (only into an empty database)
npm run dev                   # http://localhost:4000/api/v2
```

Generate a `JWT_SECRET` (at least 32 characters):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then open:

- `http://localhost:4000/api/v2/health/ready` — readiness (database and Redis)
- `http://localhost:4000/api/v2/config` — enabled optional features
- `http://localhost:4000/api/v2/docs` — Swagger UI

## Run with Docker

The full stack — API, Postgres and Redis — exactly as a reviewer runs it:

```bash
cp .env.example .env      # then fill in values (JWT_SECRET is required)
docker compose up --build
# API:  http://localhost:4000/api/v2
# Docs: http://localhost:4000/api/v2/docs
```

The container applies migrations, seeds an empty database when `SEED_DEMO_DATA=true`, then starts the server.
Compose points the API at the `postgres` and `redis` services itself, so `.env` can keep its `localhost` URLs.

To enable the GitHub integration in Docker, set `GITHUB_APP_PRIVATE_KEY_FILE=./<your-app>.private-key.pem`
(the `./` is required). The key is mounted read-only at runtime and never copied into the image; when the variable
is empty, `/dev/null` is mounted and the integration is disabled.

## Scripts

| Script                       | What it does                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`                | API with reload (`tsx watch`)                                                          |
| `npm run build` / `start`    | Compile to `dist/` / run the compiled server                                           |
| `npm run typecheck`          | `tsc` without emitting                                                                 |
| `npm run lint`               | ESLint                                                                                 |
| `npm run format`             | Prettier (`format:check` in CI)                                                        |
| `npm test`                   | Unit and integration tests (`test:unit`, `test:integration`)                           |
| `npm run db:up` / `db:down`  | Start / stop the Postgres and Redis containers                                         |
| `npm run db:migrate`         | Create and apply migrations in development (`prisma migrate dev`)                      |
| `npm run db:seed`            | Seed demo data into an empty database                                                  |
| `npm run db:reset`           | **Destroys local data:** recreate the dev and test databases, migrate and seed         |
| `npm run demo:reset`         | Restore the demo workspace (name, team, projects); for a nightly cron                  |
| `npm run cleanup:workspaces` | Delete sample workspaces unused for `SAMPLE_WORKSPACE_TTL_DAYS` days; for a daily cron |
| `npm run openapi:generate`   | Regenerate `docs/openapi.json` (`openapi:check` fails if it is stale)                  |

Integration tests use `TEST_DATABASE_URL` (`devflow_test` in the same container), migrated once per run and
truncated between tests.

## Environment

Every variable is listed in [`.env.example`](.env.example) and validated at startup; the server refuses to start
with a clear message when one is invalid. Empty values count as unset, which disables optional integrations.

| Variable                                                              | Required    | Default                 | Purpose                                                                                           |
| --------------------------------------------------------------------- | ----------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                        | yes         |                         | Postgres connection string                                                                        |
| `JWT_SECRET`                                                          | yes         |                         | Signs session tokens; at least 32 characters                                                      |
| `TEST_DATABASE_URL`                                                   | for tests   |                         | Database used by `npm test`                                                                       |
| `NODE_ENV`                                                            | no          | `development`           | `development` · `test` · `production`                                                             |
| `TRUST_PROXY`                                                         | no          | `0`                     | Proxies in front of the API, so rate limits see client IPs ([deployment](docs/DEPLOYMENT.md))     |
| `PORT`                                                                | no          | `4000`                  | HTTP port                                                                                         |
| `CORS_ORIGIN`                                                         | no          | `http://localhost:3000` | The frontend origin, allowed with credentials; also the base of emailed links and OAuth redirects |
| `API_URL`                                                             | no          | `http://localhost:4000` | Public URL of this API; builds the OAuth callback URLs registered with GitHub and Google          |
| `SEED_DEMO_DATA`                                                      | production  | `true`                  | Seed demo data into an empty database; must be set explicitly when `NODE_ENV=production`          |
| `SAMPLE_WORKSPACE_TTL_DAYS`                                           | no          | (never)                 | Days after which `npm run cleanup:workspaces` deletes an untouched sample workspace               |
| `REDIS_URL`                                                           | no          |                         | Set → Redis (Live Sync fan-out, shared rate limits); empty → in-memory fallback                   |
| `GITHUB_CLIENT_ID` / `_SECRET`                                        | no          |                         | GitHub sign-in (both required to enable)                                                          |
| `GOOGLE_CLIENT_ID` / `_SECRET`                                        | no          |                         | Google sign-in (both required to enable)                                                          |
| `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`                              | no          |                         | GitHub App integration (with the key below; see [GitHub integration](#github-integration))        |
| `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | no          |                         | The App's URL name and its own client credentials, to connect installations to workspaces         |
| `GITHUB_APP_PRIVATE_KEY_PATH`                                         | no          |                         | Path the API reads the App key from                                                               |
| `GITHUB_APP_PRIVATE_KEY_FILE`                                         | Docker only |                         | `./` path of the key Compose mounts                                                               |
| `EMAIL_PROVIDER`                                                      | production  | `console`               | `console` logs emails · `smtp` delivers them; must be set explicitly in production                |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`                                 | when `smtp` |                         | SMTP delivery (e.g. Gmail with an App Password)                                                   |
| `SMTP_PORT`, `EMAIL_FROM`                                             | no          | `465`, `DevFlow <…>`    |                                                                                                   |

The active modes are logged at startup (`realtime`, `email`, OAuth providers, GitHub integration).

## Architecture

```
src/
  app.ts              builds the Express app (middleware, routes, error handler); never listens
  server.ts           entry point: env, clients, HTTP server, graceful shutdown
  config/             env.ts (Zod-validated environment), features.ts (optional integrations)
  modules/<feature>/  routes → controller → service → repository, plus schemas and OpenAPI docs
                      (auth, users, tokens, workspace, projects, workflow, issues, comments, sprints, reports, …)
  middleware/         request id + logging, validation, auth, origin check, rate limits, problem+json errors
  realtime/           Socket.IO server (rooms, presence) and the event bus services publish to
  integrations/       email (console, smtp), OAuth providers (GitHub, Google), GitHub webhook signatures
  lib/                errors catalogue, logger, Prisma and Redis clients, hashing, pagination, ETags, shutdown
  openapi/            OpenAPI document assembly and generator
prisma/               schema, migrations, seed entry point
src/demo/             the demo workspace and tracker data (seed, sample copies, resets)
src/jobs/             scheduled jobs run from the command line (demo:reset)
tests/                integration tests (Supertest against devflow_test)
docker/               entrypoint, healthcheck, Postgres init script
```

Workspaces: sign-in identifies the user; every route under `/workspaces/:ws` passes `requireMembership`, which
resolves the slug to the caller's membership (404 for non-members) and attaches their role in that workspace, so
services always act in one workspace.

Layering: routes only wire HTTP; controllers translate requests into service calls; services hold every business
rule; repositories hold every query. Input is validated with Zod at the edge, and every error is rendered by one
handler as RFC 9457 `application/problem+json` with a stable `code`.

## GitHub integration

Optional. Create a GitHub App (Settings → Developer settings → GitHub Apps) with:

- **Webhook URL:** `<API_URL>/api/integrations/github/webhook`. GitHub must reach it, so for local development
  use a tunnel to port 4000.
- **Webhook secret:** a random string, also set as `GITHUB_WEBHOOK_SECRET`.
- **Content type** `application/json`; **permissions** Pull requests and Contents (read-only); **events** Pull request
  and Push.
- **Callback URL:** `<API_URL>/api/integrations/github/setup`, with **Request user authorization (OAuth) during
  installation** ticked. DevFlow uses it to check that whoever installs the App can access the installation before
  connecting it to their workspace.

Set `GITHUB_APP_ID`, `GITHUB_APP_SLUG` (the App's URL name, `github.com/apps/<slug>`), and the App's own
`GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` (General → Client secrets; not the OAuth app's). Download a
private key into the project root (git-ignored) and point `GITHUB_APP_PRIVATE_KEY_PATH` (or
`GITHUB_APP_PRIVATE_KEY_FILE` for Docker) at it, then restart: `GET /config` reports `githubIntegration: true`.

Each workspace connects its own installations: an admin opens the workspace's GitHub settings, which sends them to
GitHub to install the App (`docs/INTEGRATION.md` §7.5). Deliveries change issues only in the workspace their
installation is connected to. Mention issue keys (`DEV-104`) in branch names, PR titles or commit messages; GitHub's
"Recent Deliveries" tab shows each delivery and DevFlow's answer.

## Demo accounts

Created by the seed when `SEED_DEMO_DATA=true` and the database is empty: the demo workspace **Acme Inc**
(`/workspaces/acme-inc`) and its team. All use the password **`devflow-demo`**:

| Role in Acme Inc | Email                  | Person       |
| ---------------- | ---------------------- | ------------ |
| admin            | `demo@devflow.local`   | John Rey     |
| member           | `member@devflow.local` | Dmitri Kovac |
| viewer           | `viewer@devflow.local` | Lucas Brandt |

Everyone who signs up gets a workspace of their own instead, pre-filled with a copy of the sample projects.

The demo password is public, so the demo workspace and accounts are locked against changes every visitor would see:
the workspace cannot be renamed, deleted or left and takes no invites or member changes, and the accounts cannot
edit their profile, manage tokens, create workspaces or reset their password (`docs/INTEGRATION.md` §5.10, §8).
On a public deployment, also run `npm run demo:reset` nightly (`docs/DEPLOYMENT.md`). An existing database is never
re-seeded: run `npm run db:reset` (destroys local data) to pick up new demo data after upgrading.

Try it:

```bash
curl -i -c cookies.txt -H "Origin: http://localhost:3000" -H "Content-Type: application/json" \
  -d '{"email":"demo@devflow.local","password":"devflow-demo"}' http://localhost:4000/api/v2/auth/login
curl -b cookies.txt http://localhost:4000/api/v2/auth/me
```

## Contributing

- [Conventional Commits](https://www.conventionalcommits.org/) and [Semantic Versioning](https://semver.org/)
- One `feat/*` branch per milestone, merged into `main` with `--no-ff`
- Each release: `chore(release): vX.Y.Z` commit, updated [`CHANGELOG.md`](CHANGELOG.md) and an annotated tag
