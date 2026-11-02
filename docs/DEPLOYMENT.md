# Deploying DevFlow API

> **For:** whoever runs the API somewhere other than a laptop. `docker compose up --build` (README) is the review
> stack: it seeds demo accounts and is not meant to face the internet as is.

## 1. What runs

| Component  | Notes                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| API        | The image built from `Dockerfile` (Node 22, non-root `node` user, `HEALTHCHECK` on `/api/v2/health`)    |
| PostgreSQL | 16. Use a managed database or a volume you back up                                                      |
| Redis      | 7. Optional with one API instance; **required with several** (Live Sync fan-out and shared rate limits) |

The container's entrypoint applies pending migrations (`prisma migrate deploy`), seeds an empty database when
`SEED_DEMO_DATA=true`, then starts the server. Migrations only move forward; take a database backup before deploying
a release that adds one (listed in `CHANGELOG.md`).

## 2. Configuration

Every variable is described in the README and `.env.example`. In production:

| Variable                    | Set it to                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | `production` (the image's default)                                                                             |
| `JWT_SECRET`                | 32+ random bytes, unique per deployment. Rotating it signs everyone out                                        |
| `CORS_ORIGIN`               | The frontend's exact origin, e.g. `https://devflow.example.com`                                                |
| `API_URL`                   | The API's public URL; the OAuth callbacks are `${API_URL}/api/auth/oauth/{github,google}/callback`             |
| `SEED_DEMO_DATA`            | **Required in production.** `false` for a private deployment; `true` for a public demo (§5.1)                  |
| `EMAIL_PROVIDER`            | `smtp` with `SMTP_*`. **Required in production**: `console` writes reset and invite links to the log           |
| `DATABASE_URL`, `REDIS_URL` | Use TLS (`?sslmode=require`, `rediss://`) and strong credentials when they leave a private network             |
| `TRUST_PROXY`               | The number of proxies in front of the API (usually `1`), so rate limits and logs see client IPs, not the proxy |

The API refuses to start with a list of what is wrong when a variable is invalid or missing; values are never echoed.

Secrets (`JWT_SECRET`, OAuth and SMTP credentials, `GITHUB_WEBHOOK_SECRET`, the GitHub App key) belong in the
platform's secret store, not in the image: `.dockerignore` excludes `.env*` and `*.pem`. Mount the App key read-only
and point `GITHUB_APP_PRIVATE_KEY_PATH` at it, as `docker-compose.yml` does.

## 3. Network

- **TLS:** terminate HTTPS in front of the API (load balancer, reverse proxy). Session cookies are `Secure`, so
  browsers only send them over HTTPS (or to `localhost`).
- **Same site:** cookies are `SameSite=Lax`. Serve the frontend and the API from the same site, e.g.
  `app.example.com` and `api.example.com`, or the browser will not send the session to the API.
- **Paths:** route all of `/api` to the API, not only `/api/v2`: the OAuth callbacks (`/api/auth/oauth/…`) and the
  GitHub webhook (`/api/integrations/github/webhook`) live outside the versioned prefix so that new API versions
  never require reconfiguring GitHub or Google.
- **WebSockets:** the proxy must allow upgrades on `/api/v2/socket.io` and keep idle connections open for at least a
  minute.
- **Several instances:** set `REDIS_URL` on every instance. Socket.IO's HTTP long-polling fallback also needs sticky
  sessions on `/api/v2/socket.io`; with WebSocket-only clients it does not.
- **Exposure:** only the API port should be public. Keep PostgreSQL and Redis on a private network;
  `docker-compose.yml` publishes them on `127.0.0.1` for local development only.

## 4. Health and shutdown

- `GET /api/v2/health` (liveness) answers `200` whenever the process runs; use it for restarts.
- `GET /api/v2/health/ready` checks the database and Redis and answers `503` when one is down; use it for routing
  traffic. Neither is rate-limited.
- On `SIGTERM` the API stops accepting connections, disconnects sockets (clients reconnect to another instance),
  finishes in-flight requests, then closes Redis and the database. Allow about 10 seconds before a hard kill.

## 5. Security checklist

- [ ] `SEED_DEMO_DATA=false` and no `@devflow.local` demo accounts in the database, or a public demo set up as in
      §5.1
- [ ] `EMAIL_PROVIDER=smtp`, and a password reset email arrives
- [ ] HTTPS everywhere; `CORS_ORIGIN` and `API_URL` use `https://`
- [ ] `TRUST_PROXY` matches the proxies in front of the API (check that a request log shows your own IP)
- [ ] PostgreSQL and Redis unreachable from the internet, with non-default credentials
- [ ] OAuth apps and the GitHub App registered with the production callback and webhook URLs
      (`/api/auth/oauth/{provider}/callback`, `/api/integrations/github/webhook`)
- [ ] Logs collected; they are JSON lines and never contain cookies, tokens or passwords
- [ ] Database backups scheduled and a restore tested

### 5.1 A public demo

To let visitors try DevFlow with the published demo accounts, run with `SEED_DEMO_DATA=true`. The seeded workspace
(Acme Inc) and its five accounts are then locked against changes every visitor would see: the workspace cannot be
renamed, deleted or left and takes no invites or member changes; the accounts cannot edit their profile, manage
access tokens, create workspaces or reset their password, and OAuth never takes them over. Issues, sprints and
projects stay open, so restore the workspace every night:

```bash
# development:      npm run demo:reset
# the image:        node dist/src/jobs/demo-reset.js
# e.g. cron, 03:00: 0 3 * * * docker compose -f /srv/devflow/docker-compose.yml exec -T api node dist/src/jobs/demo-reset.js
```

It restores the workspace name, the demo team's memberships and roles, removes pending invites and replaces every
project with a fresh copy of the demo data. It logs `demo workspace restored`, and does nothing on a database without
a demo workspace. Visitors who sign up get their own workspaces, which the job never touches.

## 6. Built-in protections

- **Rate limits** per client IP: 600 requests a minute overall, plus tighter limits on sign-in (10 failures per
  account and IP every 15 minutes), sign-up, password reset, OAuth, refresh, invites and invite links, and GitHub
  deliveries. Counted in Redis when configured, otherwise per instance; if Redis fails, requests pass.
- **Sessions:** short-lived access tokens, rotating refresh tokens with reuse detection, server-side revocation. A
  password reset, or OAuth claiming an account first registered with a password, revokes every session and access
  token.
- **Workspaces:** every workspace route checks membership on every request; non-members get the same `404` as for
  a workspace that does not exist. Access tokens work only in the workspace they were created for.
- **Requests:** `helmet` headers, CORS restricted to `CORS_ORIGIN`, an Origin check on cookie-authenticated writes
  and socket handshakes, 100 kB JSON bodies, validated input, roles and token scopes enforced on every route.
- **Webhooks:** GitHub deliveries are accepted only with a valid `X-Hub-Signature-256`.
