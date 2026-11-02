# DevFlow API — Backend Brief

> **For:** the backend developer (human or AI agent) building the DevFlow API.
> **This repo:** https://github.com/JohnReySeguma/dev-flow-be
> **Frontend repo:** https://github.com/JohnReySeguma/dev-flow (Next.js 16, released as `v1.0.0`)
> Paste this whole document as your starting prompt, together with [`FRONTEND_HANDOFF.md`](FRONTEND_HANDOFF.md),
> which defines what you must deliver back to the frontend at every release.
>
> **Scope:** the DevFlow **app** only. The public website (landing, legal, status pages) is static in the frontend —
> no CMS, no content or contact endpoints.

---

## 1. Your task

Build the REST + WebSocket API that replaces the frontend's in-browser demo store. Today every action runs against
`localStorage` through the frontend's `lib/tracker/store.ts`; each exported function there maps to an endpoint below.
When you are done, the frontend should be able to swap that file for an API client without changing any UI.

**Read these frontend files first** — they are the source of truth for shapes and business rules:

| File | What it defines |
| --- | --- |
| [`lib/tracker/types.ts`](https://github.com/JohnReySeguma/dev-flow/blob/main/lib/tracker/types.ts) | `Project`, `WorkflowStatus`, `Sprint`, `SprintReport`, `Issue`, enums |
| [`lib/tracker/store.ts`](https://github.com/JohnReySeguma/dev-flow/blob/main/lib/tracker/store.ts) | Every mutation the UI performs, with its rules |
| [`lib/tracker/selectors.ts`](https://github.com/JohnReySeguma/dev-flow/blob/main/lib/tracker/selectors.ts) | Derived data and guard rules (e.g. `cannotDeleteStatusReason`) |
| [`lib/tracker/seed.ts`](https://github.com/JohnReySeguma/dev-flow/blob/main/lib/tracker/seed.ts) | Demo data — reproduce it as a database seed |
| [`lib/account-data.ts`](https://github.com/JohnReySeguma/dev-flow/blob/main/lib/account-data.ts) | User profile, roles, team members, access tokens |
| [`lib/members.ts`](https://github.com/JohnReySeguma/dev-flow/blob/main/lib/members.ts) | Member shape (name, handle, avatar colour, presence) |

---

## 2. The product process you are implementing

```
Workspace ── Members (admin / member / viewer)
  └─ Project ── owns a Workflow (ordered statuses, each in a category: todo | in_progress | done)
       ├─ Backlog ……… issues with sprintId = null, ranked
       ├─ Sprints ……… planned → active (max ONE per project) → completed
       │               the board shows only the active sprint
       └─ Complete …… snapshots a report; unfinished issues move to the backlog,
                       a planned sprint, or a newly created sprint
```

---

## 3. Stack & environments

### Already chosen (see `package.json`)

| Concern | Choice |
| --- | --- |
| Runtime | Node.js 22+ with TypeScript, run in development with `tsx` |
| HTTP | Express 5 + `cors` |
| Auth tokens | `jsonwebtoken` — JWT stored in an **httpOnly cookie** for the web app (never in `localStorage`) |
| Realtime | Socket.IO |
| Email | Nodemailer |
| GitHub | `@octokit/app` + `@octokit/rest` |
| Config | `dotenv` |

### Still to add (recommended; justify any change in the README)

- **Database:** PostgreSQL 16 with Prisma (or Drizzle) for migrations and the seed
- **Redis client:** `ioredis` + `@socket.io/redis-adapter` (only used when `REDIS_URL` is set)
- **Validation:** Zod, with `zod-to-openapi` (or similar) to publish an **OpenAPI 3.1** spec
- **Passwords:** `argon2`
- **Security middleware:** `helmet`, a rate limiter (`express-rate-limit`, Redis store when available), `cookie-parser`
- **Tests:** Vitest + Supertest
- **Lint/format:** ESLint + Prettier
- Add `npm` scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `db:migrate`, `db:seed`

### 3.1 Development — databases in Docker, API on the host

PostgreSQL is **not** installed on this machine. Postgres and Redis run as Docker containers; the API itself runs with
plain Node.js on the host so code changes reload instantly.

- **Docker Desktop must be running** (it can be minimised to the tray). If a `docker` command fails with
  "Cannot connect to the Docker daemon", **stop and ask the user to start Docker Desktop**. Never try to install
  PostgreSQL or Redis on the host.
- Add npm scripts that wrap the containers:
  - `npm run db:up` → `docker compose up -d postgres redis` (starts only the databases, in the background)
  - `npm run db:down` → `docker compose stop postgres redis`
  - `npm run db:reset` → drop and recreate both databases, migrate and seed
- Daily loop: `npm run db:up` → `npm run db:migrate` → `npm run db:seed` → `npm run dev` (API on `http://localhost:4000`).
- `.env` for development points at the published ports: `DATABASE_URL=…@localhost:5432/devflow`,
  `TEST_DATABASE_URL=…@localhost:5432/devflow_test`, `REDIS_URL=redis://localhost:6379`.
- **Tests** (`npm test`) run on the host against `TEST_DATABASE_URL` in the same Postgres container, resetting state
  between suites with transactions or truncation. Don't use Testcontainers; reuse the Compose databases.
- **Keep the Redis fallback anyway:** when `REDIS_URL` is empty, use in-process implementations (Socket.IO's default
  adapter, an in-memory rate limiter). CI and quick experiments rely on it.
- Read every setting from environment variables with validated defaults. Nothing may hard-code container hostnames.

### 3.2 Delivery — Docker for review and production

Each release must include working container files. **Before tagging, run the full stack yourself**
(`docker compose up --build`, then check `/health/ready`); the reviewer verifies it again at every tag, and CI builds
the image (§6).

- **`Dockerfile`** — multi-stage (`node:22-alpine`): install and build in one stage, run as a non-root user with production dependencies only. `EXPOSE 4000`. `HEALTHCHECK` against `/health`.
- **`docker-compose.yml`** — services `api`, `postgres` (16) and `redis` (7), named volumes, health checks; `api` waits on healthy databases.
- **Migrations and seed on start** — the entrypoint runs `migrate deploy`, then the seed when `SEED_DEMO_DATA=true` and the database is empty, then starts the server.
- **`.dockerignore`** excluding `node_modules`, `.env`, `*.pem`, tests and `.git`. **Secrets are never baked into the image.**
- **README "Run with Docker"** — the exact commands the reviewer uses:

  ```bash
  cp .env.example .env      # then fill in values
  docker compose up --build
  # API:  http://localhost:4000/api/v1
  # Docs: http://localhost:4000/api/v1/docs
  ```

### 3.3 Configuration — one codebase, two modes

The **only** difference between development and Docker is environment variables. Code must never check "am I in Docker?".
`.env.example` in this repo lists every variable. Validate them at startup (Zod) and **fail fast** with a clear message when a required one is missing.

| Variable | Required? | Development | Docker Compose | Behaviour |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | yes | `…@localhost:5432/devflow` | `…@postgres:5432/devflow` | |
| `JWT_SECRET` | yes | random string | random string | Signs session JWTs |
| `PORT` | no | `4000` | `4000` | |
| `CORS_ORIGIN` | no | `http://localhost:3000` | `http://localhost:3000` | The frontend URL |
| `SEED_DEMO_DATA` | no | `true` | `true` | Seed when the database is empty |
| `REDIS_URL` | no | `redis://localhost:6379` | `redis://redis:6379` | **Set → Redis** adapter + rate limits; **empty → in-memory** |
| `GITHUB_CLIENT_ID` / `_SECRET` | no | | | Empty → GitHub sign-in disabled |
| `GOOGLE_CLIENT_ID` / `_SECRET` | no | | | Empty → Google sign-in disabled |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, `GITHUB_WEBHOOK_SECRET` | no | `./<file>.pem` | `/run/secrets/github-app.pem` | Empty → GitHub integration disabled |
| `EMAIL_PROVIDER` | no | `console` | `console` or `smtp` | `console` prints emails to the log; `smtp` sends via `SMTP_*`; `resend` reserved for later |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | when `smtp` | | | Real delivery (e.g. Gmail with an App Password) |

**Optional integrations must degrade gracefully.** Expose them to the frontend through `GET /api/v1/config`
(`{ oauth: { github: bool, google: bool }, githubIntegration: bool }`) so it can hide buttons that won't work.
Log the active modes at startup, e.g. `realtime: redis` / `realtime: in-memory`, `email: console`.

Expected `docker-compose.yml` shape:

```yaml
services:
  api:
    build: .
    ports: ["4000:4000"]
    env_file: .env
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/devflow
      REDIS_URL: redis://redis:6379
      GITHUB_APP_PRIVATE_KEY_PATH: /run/secrets/github-app.pem
    volumes:
      # The key stays on the host and is mounted read-only — never copied into the image.
      - ./${GITHUB_APP_PRIVATE_KEY_FILE:-github-app.pem}:/run/secrets/github-app.pem:ro
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }

  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: postgres, POSTGRES_PASSWORD: postgres, POSTGRES_DB: devflow }
    ports: ["5432:5432"]          # published so `npm run dev` on the host can connect
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro   # creates devflow_test
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres"], interval: 5s, retries: 10 }

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, retries: 10 }

volumes:
  pgdata:
```

---

## 4. Conventions

| Topic | Rule |
| --- | --- |
| Base URL | `/api/v1` |
| IDs | UUIDs internally; issues are addressed by their **key** (`DEV-104`) and projects by their **key** (`DEV`) in URLs |
| Timestamps | ISO 8601 UTC strings (`2026-11-01T09:00:00.000Z`) |
| JSON | camelCase fields, matching the frontend's `lib/tracker/types.ts` exactly |
| Errors | [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` with a machine-readable `code` (e.g. `SPRINT_ALREADY_ACTIVE`) |
| Validation errors | `422` with `errors: [{ field, message }]` |
| Lists | Cursor pagination: `?limit=50&cursor=…` → `{ items, nextCursor }` |
| Concurrency | `ETag` / `If-Match` on PATCH to prevent lost updates (`412` on conflict) |
| Auth (web) | Short-lived access JWT + rotating refresh token, both in **httpOnly, `Secure`, `SameSite=Lax`** cookies |
| Auth (CLI/API) | `Authorization: Bearer dfp_…` personal access tokens |
| Permissions | **viewer** = read-only · **member** = edit issues/sprints · **admin** = also members, workflow, project delete |

---

## 5. Endpoints

### 5.1 Auth & session

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/config` | Which optional features are enabled (§3.3) — no auth |
| POST | `/auth/signup` | `{ name, email, password }` → user + session cookies. Password ≥ 8 chars, Argon2id |
| POST | `/auth/login` | `{ email, password }` → session cookies |
| POST | `/auth/refresh` | Rotate the refresh token (reuse of an old one revokes the whole session family) |
| POST | `/auth/logout` | Revoke the session and clear cookies |
| GET | `/auth/me` | Current user + workspace + role (called on app load) |
| GET | `/auth/oauth/:provider` | Start OAuth (`github`, `google`); `404` when that provider is not configured |
| GET | `/auth/oauth/:provider/callback` | Finish OAuth, link or create the account, redirect to `${CORS_ORIGIN}/projects` |
| POST | `/auth/password/forgot` | `{ email }` → always `202` (never reveal whether the account exists) |
| POST | `/auth/password/reset` | `{ token, password }` (single-use, 1-hour token) |

OAuth callback URLs registered with the providers:
`http://localhost:4000/api/v1/auth/oauth/github/callback` and `http://localhost:4000/api/v1/auth/oauth/google/callback`.

### 5.2 Profile & personal access tokens

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/me` | Profile: `name, handle, email, avatarColor, timezone, bio, role` |
| PATCH | `/me` | Update `name, avatarColor, timezone, bio`. Valid IANA timezone; bio ≤ 280; name ≤ 48 |
| GET | `/me/tokens` | `id, name, lastFour, scopes, createdAt, lastUsedAt, expiresAt` |
| POST | `/me/tokens` | `{ name, scopes[], expiresInDays \| null }` → `{ token, secret }`. **Secret returned once**; store a SHA-256 hash |
| DELETE | `/me/tokens/:id` | Revoke |

Scopes: `issues:read`, `issues:write`, `projects:admin`, `webhooks:manage`. Update `lastUsedAt` when a token authenticates.

### 5.3 Workspace & members

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/workspace` | Name, current user's role |
| GET | `/workspace/members` | `id, name, email, initials, avatarColor, role, status (active\|invited), lastActiveAt` |
| PATCH | `/workspace/members/:id` | `{ role }` — admin only |
| DELETE | `/workspace/members/:id` | Remove member or revoke invite — admin only |
| POST | `/workspace/invites` | `{ email, role }` → sends invite email; `409` if already a member |
| POST | `/workspace/invites/:id/resend` | Re-send invite email |
| POST | `/invites/:token/accept` | Accept invite (signed, single-use, 7-day expiry) |
| POST | `/workspace/demo/reset` | Only when `SEED_DEMO_DATA=true`: restore seed data |

**Rules:** you cannot change your own role; the last active admin cannot be demoted or removed (`LAST_ADMIN`).

### 5.4 Projects

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/projects` | Each project plus summary: `activeSprint { name, endAt, donePoints, totalPoints, doneIssues, totalIssues }`, `backlogCount`, `lead` |
| POST | `/projects` | `{ name, key, description }`. Key `^[A-Z]{2,5}$`, unique per workspace. Creates the default workflow: To Do (todo), In Progress, In Review (in_progress), Done (done) |
| GET | `/projects/:key` | Project with ordered `workflow[]` |
| PATCH | `/projects/:key` | `{ name, description }` (key is immutable) |
| DELETE | `/projects/:key` | Admin only; cascades sprints and issues |

### 5.5 Workflow (board columns)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/projects/:key/statuses` | `{ name, category }`. Inserted **before the first done status** unless category is `done` |
| PATCH | `/projects/:key/statuses/:id` | `{ name?, category? }`. Changing category recalculates `resolvedAt` for issues in it |
| PUT | `/projects/:key/statuses/order` | `{ statusIds: [] }` full reorder |
| DELETE | `/projects/:key/statuses/:id?moveTo=:statusId` | Moves its issues to `moveTo`, then deletes |

**Guards** (mirror `cannotDeleteStatusReason`): at least 2 statuses; at least one `todo` and one `done` status must always exist.

### 5.6 Issues

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/projects/:key/issues` | Filters: `sprint=<id>\|backlog\|active`, `assignee`, `priority`, `type`, `q`, `mine=true`. Ordered by rank |
| POST | `/projects/:key/issues` | `{ title, description, type, priority, assigneeId, estimate, sprintId, statusId? }` → key `PROJ-n`. Default status = first `todo` status |
| GET | `/issues/:issueKey` | Full issue (accept `104` or `dev-104`, case-insensitive, for ⌘K jump) |
| PATCH | `/issues/:issueKey` | Any of `title, description, type, priority, assigneeId, estimate, statusId, sprintId` |
| POST | `/issues/:issueKey/move` | `{ statusId?, sprintId?, beforeIssueKey? }` — board drop and backlog drag-ranking |
| DELETE | `/issues/:issueKey` | Delete |
| GET | `/issues/:issueKey/comments` | Comment thread |
| POST | `/issues/:issueKey/comments` | `{ body }` (Markdown, sanitised on render) |

**Rules**
- Issue numbers come from a per-project counter **assigned atomically** (row lock or sequence) so two users never get the same key.
- `resolvedAt` is set when an issue enters a `done`-category status and cleared when it leaves. The client never sends it.
- `estimate` ∈ `{1, 2, 3, 5, 8, 13}` or `null`.
- Ranking: fractional / LexoRank strings so moves never renumber the list.
- Record every status, sprint and estimate change in an `issue_events` table (needed for accurate burndown, §5.8).

### 5.7 Sprints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/projects/:key/sprints?status=planned,active,completed` | Ordered by `number` |
| POST | `/projects/:key/sprints` | Creates `Sprint {number+1}`, status `planned` |
| PATCH | `/sprints/:id` | `{ name, goal }` |
| DELETE | `/sprints/:id` | Planned sprints only; their issues return to the backlog |
| POST | `/sprints/:id/start` | `{ name, goal, durationDays }`. `409 SPRINT_ALREADY_ACTIVE` if one is running. Snapshot `committedPoints` |
| POST | `/sprints/:id/complete` | `{ carryOver: { kind: "backlog" } \| { kind: "sprint", sprintId } \| { kind: "new-sprint" } }`. In **one transaction**: write the report, set `completedAt`, move unfinished issues |

### 5.8 Reports

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/sprints/:id/burndown` | `days: [{ date, ideal, remaining \| null }]` — one point per sprint day, from `issue_events` |
| GET | `/projects/:key/reports/velocity?limit=8` | `[{ sprintId, name, committed, completed }]` for completed sprints |
| GET | `/projects/:key/reports/history` | Completed sprints with goal, dates and report |

### 5.9 Realtime ("Live Sync") — Socket.IO

Namespace `/realtime`, authenticated with the session cookie (or a PAT in the handshake `auth`). Clients join a project room:
`socket.emit("project:join", "DEV")`.

Server events, each carrying the full updated resource:
`issue.created`, `issue.updated`, `issue.moved`, `issue.deleted`, `sprint.created`, `sprint.updated`,
`sprint.started`, `sprint.completed`, `workflow.updated`, `project.updated`, `presence.updated`.

Use `@socket.io/redis-adapter` when `REDIS_URL` is set so events reach clients on every API instance.

### 5.10 GitHub integration

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/integrations/github/webhook` | Receive `pull_request` and `push`. **Verify `X-Hub-Signature-256` with `GITHUB_WEBHOOK_SECRET`** (use the raw body) and reject anything else |

The GitHub App is already registered (Contents + Pull requests read-only; subscribed to Pull request and Push).
Parse issue keys (`DEV-104`) from branch names, PR titles and commit messages and store `Issue.git`
(`{ kind: "pr", number, state: open|draft|merged }` or `{ kind: "commit", sha }`). When a linked PR is merged, move the issue
to the project's first `done` status and broadcast `issue.moved`.

Local testing relays webhooks with `npx smee-client --url <smee-url> --target http://localhost:4000/api/v1/integrations/github/webhook`.

### 5.11 Operational

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness (no auth) |
| GET | `/health/ready` | Readiness: database (and Redis when configured) reachable |
| GET | `/docs` | Swagger UI for the OpenAPI spec |
| GET | `/bootstrap` | `{ me, workspace, config, projects }` in one call (see `FRONTEND_HANDOFF.md` §4) |
| GET | `/projects/:key/snapshot` | `{ project, sprints, issues }` for rendering a whole project (see `FRONTEND_HANDOFF.md` §4) |

---

## 6. Non-functional requirements

- **Secrets:** `.env` and `*.pem` are git-ignored and docker-ignored. Never commit, log, or bake them into an image. Never print a secret in error messages.
- **Security:** Argon2id passwords; hashed PATs and refresh tokens; `helmet`; CSRF protection for cookie auth (SameSite + `Origin` check on writes); strict CORS (`CORS_ORIGIN` only, `credentials: true`); rate limits on auth and invites.
- **Authorization:** enforce roles server-side on every route; a viewer calling a write endpoint gets `403`.
- **Data integrity:** sprint start/complete, status delete and project delete run in transactions.
- **Seed:** `npm run db:seed` reproduces the frontend's `lib/tracker/seed.ts` (three projects, sprints, issues) with dates relative to now.
- **Docs:** OpenAPI spec at `/api/v1/docs`; README with setup, environment variables and architecture.
- **CI (GitHub Actions):** on every push and pull request run typecheck, lint and tests against Postgres and Redis **service containers**, and run `docker build` so a broken Dockerfile is caught on every push.

---

## 7. Git workflow — follow the frontend's conventions exactly

Look at `git log --graph` in the frontend repo; this repo's history must read the same way.

1. **Conventional Commits** — `feat(scope): …`, `fix(scope): …`, `refactor:`, `test:`, `build(deps):`, `ci:`, `docs:`, `chore(release): vX.Y.Z`. Imperative, lower case, no period. Add a body explaining *why* when it isn't obvious.
2. **Small, focused commits** — one logical change each. Every commit must typecheck, lint and pass tests on its own.
3. **Feature branches** — one `feat/*` branch per milestone, branched from `main`. Use `fix/*` for bug fixes. Never commit directly to `main` except release commits.
4. **Merge with `--no-ff`** into `main` so each feature remains visible in `git log --graph`. Delete the branch after merging. (Opening a pull request on GitHub for each branch and merging it with a merge commit achieves the same and is encouraged.)
5. **Release commit on `main`** after each merge:
   - `npm version X.Y.Z --no-git-tag-version` (updates `package.json` and the lockfile)
   - Update `CHANGELOG.md` in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format, newest first, with compare links
   - Commit as `chore(release): vX.Y.Z`
   - Annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z — <milestone>"`
6. **Push** with `git push origin main --follow-tags`.
7. **Semantic Versioning** — new endpoints are minor; fixes are patch; breaking API changes after `1.0.0` are major and need a new `/api/v2` prefix.

### Suggested milestones

| Release | Branch | Scope |
| --- | --- | --- |
| `v0.1.0` | `feat/foundation` | `src/` layout, env validation, Postgres + migrations, error format, `/health`, `/config`, logging, CI, `Dockerfile` + `docker-compose.yml` |
| `v0.2.0` | `feat/auth` | Signup/login/refresh/logout/me, OAuth (optional providers), password reset, email providers, profile, PATs |
| `v0.3.0` | `feat/workspace` | Members, roles, invites, permission middleware |
| `v0.4.0` | `feat/projects-issues` | Projects, workflow statuses, issues, ranking, comments, seed |
| `v0.5.0` | `feat/sprints-reports` | Sprint lifecycle, issue events, burndown, velocity, history |
| `v0.6.0` | `feat/realtime-github` | Socket.IO Live Sync, GitHub webhooks |
| `v1.0.0` | `feat/hardening` | Rate limits, OpenAPI docs, security review, deployment notes, README |

---

## 8. Definition of done

- [ ] Every function in the frontend's `lib/tracker/store.ts` and every action on the profile and workspace pages has an endpoint.
- [ ] All business rules in §5 are enforced server-side and covered by tests.
- [ ] Response shapes match the frontend's `lib/tracker/types.ts` field-for-field.
- [ ] OpenAPI spec published; `.env.example` complete; the seed works on a fresh database.
- [ ] Development works with only Docker Desktop installed: `npm run db:up` → `npm run dev` / `npm test`, with every optional integration unset.
- [ ] `docker compose up --build` from a fresh clone starts the API, Postgres and Redis, migrates, seeds and passes `/health/ready` — checked by the reviewer at every release tag.
- [ ] Every release satisfies the handoff checklist in [`FRONTEND_HANDOFF.md`](FRONTEND_HANDOFF.md) §8.
- [ ] History follows §7, with tags `v0.1.0` … `v1.0.0` pushed.
