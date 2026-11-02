# DevFlow API — Frontend Integration Guide

> **For:** the frontend ([`dev-flow`](https://github.com/JohnReySeguma/dev-flow)).
> **Accurate for:** `v0.1.0`. Updated at every release (see [`FRONTEND_HANDOFF.md`](FRONTEND_HANDOFF.md)).
> **Machine-readable contract:** [`openapi.json`](openapi.json), also served at `/api/v1/openapi.json`, with
> Swagger UI at `/api/v1/docs`.
> **Step-by-step plan for the frontend:** [`FRONTEND_BRIEF.md`](FRONTEND_BRIEF.md).

---

## 1. Conventions

| Topic      | Contract                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL   | `http://localhost:4000/api/v1` (development and Docker)                                                                                                    |
| JSON       | camelCase, field names and enum values identical to `lib/tracker/types.ts`                                                                                 |
| Timestamps | ISO 8601 UTC strings, e.g. `2026-11-01T09:00:00.000Z`                                                                                                      |
| CORS       | Only `CORS_ORIGIN` (default `http://localhost:3000`), with credentials. Send `credentials: "include"`.                                                     |
| Request id | Every response carries `X-Request-Id`; error bodies repeat it as `requestId`. You may send your own `X-Request-Id` (≤ 128 chars of `A–Z a–z 0–9 _ . : -`). |
| Errors     | RFC 9457 `application/problem+json` with a stable `code` (§4)                                                                                              |

Not yet available (planned): cursor pagination (`?limit&cursor` → `{ items, nextCursor }`) and `ETag` / `If-Match`
concurrency (`412 CONFLICT_STALE`) arrive with the first list and PATCH endpoints in `v0.3.0`–`v0.4.0`.

## 2. Endpoint coverage matrix

**Since** is the first release that serves the endpoint; blank means not yet available.

### Board, backlog and project data — `lib/tracker/store.ts`

| Frontend function             | UI action                             | Endpoint                                                    | Since |
| ----------------------------- | ------------------------------------- | ----------------------------------------------------------- | ----- |
| `useTracker()` (initial data) | Load the app / a project              | `GET /bootstrap`, `GET /projects/:key/snapshot`             |       |
| `createIssue`                 | Create Issue dialog, quick add        | `POST /projects/:key/issues`                                |       |
| `updateIssue`                 | Issue sheet field edits               | `PATCH /issues/:issueKey`                                   |       |
| `moveIssueToStatus`           | Drag card between board columns       | `POST /issues/:issueKey/move`                               |       |
| `moveIssueToSprint`           | Backlog drag, "Move to" menu, ranking | `POST /issues/:issueKey/move`                               |       |
| `deleteIssue`                 | Issue sheet → Delete                  | `DELETE /issues/:issueKey`                                  |       |
| `createSprint`                | Backlog → "+ Sprint"                  | `POST /projects/:key/sprints`                               |       |
| `updateSprint`                | Edit sprint name & goal               | `PATCH /sprints/:id`                                        |       |
| `deleteSprint`                | Delete planned sprint                 | `DELETE /sprints/:id`                                       |       |
| `startSprint`                 | Start sprint dialog                   | `POST /sprints/:id/start`                                   |       |
| `completeSprint`              | Complete sprint dialog                | `POST /sprints/:id/complete`                                |       |
| `addStatus`                   | Board "Add column", settings          | `POST /projects/:key/statuses`                              |       |
| `updateStatus`                | Rename column, change category        | `PATCH /projects/:key/statuses/:id`                         |       |
| `moveStatus`                  | Move column left/right                | `PUT /projects/:key/statuses/order`                         |       |
| `deleteStatus`                | Delete column                         | `DELETE /projects/:key/statuses/:id?moveTo=`                |       |
| `createProject`               | New project dialog                    | `POST /projects`                                            |       |
| `updateProject`               | Project settings → General            | `PATCH /projects/:key`                                      |       |
| `deleteProject`               | Project settings → Delete             | `DELETE /projects/:key`                                     |       |
| `resetDemoData`               | Workspace settings → Reset demo data  | `POST /workspace/demo/reset`                                |       |
| Reports page                  | Burndown, velocity, history           | `GET /sprints/:id/burndown`, `GET /projects/:key/reports/*` |       |

### Account and workspace

| Frontend component                     | UI action                           | Endpoint                                               | Since |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------ | ----- |
| `components/auth/auth-form.tsx`        | Sign in / sign up / forgot password | `/auth/login`, `/auth/signup`, `/auth/password/forgot` |       |
| `auth-form.tsx` OAuth buttons          | Show / hide providers               | `GET /config`                                          | 0.1.0 |
| `auth-form.tsx` OAuth buttons          | Continue with GitHub / Google       | `GET /auth/oauth/:provider`                            |       |
| `components/layout/app-sidebar.tsx`    | Log out                             | `POST /auth/logout`                                    |       |
| `components/profile/profile-view.tsx`  | Save personal settings              | `PATCH /me`                                            |       |
| `components/profile/access-tokens.tsx` | Generate / revoke token             | `POST /me/tokens`, `DELETE /me/tokens/:id`             |       |
| `components/settings/team-members.tsx` | Invite, resend, change role, remove | `/workspace/invites…`, `/workspace/members/:id`        |       |

### Operational

| Endpoint            | Purpose                                               | Since |
| ------------------- | ----------------------------------------------------- | ----- |
| `GET /health`       | Liveness, `{ status: "ok" }`                          | 0.1.0 |
| `GET /health/ready` | Readiness: `200` / `503` with per-dependency `checks` | 0.1.0 |
| `GET /openapi.json` | OpenAPI 3.1 document                                  | 0.1.0 |
| `GET /docs`         | Swagger UI                                            | 0.1.0 |

## 3. Feature flags — `GET /config`

No authentication; call it before sign-in (it will also be part of `GET /bootstrap`). Cached for 5 minutes
(`Cache-Control: public, max-age=300`); values change only when the server restarts.

```json
{ "oauth": { "github": true, "google": false }, "githubIntegration": false, "email": false }
```

| Field               | Meaning for the UI                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oauth.github`      | Show "Continue with GitHub"                                                                                                                                                         |
| `oauth.google`      | Show "Continue with Google"                                                                                                                                                         |
| `githubIntegration` | GitHub App configured: PR / commit links on issues will update                                                                                                                      |
| `email`             | `true` = emails (password reset, invites) are delivered; `false` = they are only written to the server log (demo mode). Password reset and invites still return success either way. |

## 4. Errors

Every error is `application/problem+json`:

```json
{
  "type": "urn:devflow:error:SPRINT_ALREADY_ACTIVE",
  "title": "Another sprint is already active",
  "status": 409,
  "detail": "Sprint 25 is already active in DEV.",
  "instance": "/api/v1/sprints/0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e6f/start",
  "code": "SPRINT_ALREADY_ACTIVE",
  "requestId": "6f1c2a9e-3b7d-4c8e-9f0a-1b2c3d4e5f60"
}
```

- Switch on **`code`**, never on `title` or `detail` (human-readable, may change).
- `422 VALIDATION_FAILED` adds `errors: [{ field, message }]`, one entry per invalid field. `field` is the
  dot-separated path within the body, query or route parameters (e.g. `title`, `carryOver.sprintId`).

### Error catalogue

Codes are stable: new ones may be added, existing ones are never renamed or repurposed. "Reserved" codes are part of
the contract already but no endpoint returns them yet.

| Code                     | HTTP | Meaning                                                        | Returned by                         |
| ------------------------ | ---- | -------------------------------------------------------------- | ----------------------------------- |
| `BAD_REQUEST`            | 400  | The body is not valid JSON                                     | Any endpoint with a JSON body       |
| `UNAUTHENTICATED`        | 401  | Not signed in; redirect to `/login`                            | Reserved (`v0.2.0`)                 |
| `TOKEN_EXPIRED`          | 401  | Access token expired; call `POST /auth/refresh` once and retry | Reserved (`v0.2.0`)                 |
| `INVALID_CREDENTIALS`    | 401  | Wrong email or password                                        | Reserved (`v0.2.0`)                 |
| `FORBIDDEN`              | 403  | Signed in, but the role does not allow this                    | Reserved (`v0.3.0`)                 |
| `CANNOT_CHANGE_OWN_ROLE` | 403  | Admins cannot change their own role                            | Reserved (`v0.3.0`)                 |
| `NOT_FOUND`              | 404  | Unknown route or resource                                      | Any unknown route                   |
| `EMAIL_TAKEN`            | 409  | Sign-up with an existing email                                 | Reserved (`v0.2.0`)                 |
| `PROJECT_KEY_TAKEN`      | 409  | Project key already in use                                     | Reserved (`v0.4.0`)                 |
| `SPRINT_ALREADY_ACTIVE`  | 409  | Another sprint is active in the project                        | Reserved (`v0.5.0`)                 |
| `SPRINT_NOT_PLANNED`     | 409  | Only planned sprints can be started or deleted                 | Reserved (`v0.5.0`)                 |
| `STATUS_DELETE_BLOCKED`  | 409  | Deleting would break the workflow guards                       | Reserved (`v0.4.0`)                 |
| `LAST_ADMIN`             | 409  | The last active admin cannot be demoted or removed             | Reserved (`v0.3.0`)                 |
| `ALREADY_MEMBER`         | 409  | The invited email already belongs to a member                  | Reserved (`v0.3.0`)                 |
| `CONFLICT_STALE`         | 412  | `If-Match` no longer matches; re-fetch and retry               | Reserved                            |
| `PAYLOAD_TOO_LARGE`      | 413  | Body larger than 100 kB                                        | Any endpoint with a JSON body       |
| `VALIDATION_FAILED`      | 422  | Invalid fields, listed in `errors`                             | Reserved (first inputs in `v0.2.0`) |
| `RATE_LIMITED`           | 429  | Too many requests; retry later                                 | Reserved (`v1.0.0`)                 |
| `INTERNAL_ERROR`         | 500  | Unexpected failure; quote `requestId` when reporting           | Any endpoint                        |

## 5. Authentication

Ships in `v0.2.0` (cookies, refresh, CSRF, OAuth redirects, password-reset and invite link formats). Until then every
endpoint is public.

## 6. Realtime

Ships in `v0.6.0` (Socket.IO namespace `/realtime`). No events yet.

## 7. Demo data

`v0.1.0` seeds only the demo workspace (Acme Inc). The projects DEV, BIL and MOB arrive in `v0.4.0`, and the demo
accounts for each role in `v0.2.0`.

## 8. Known limitations

- Only operational endpoints and `GET /config` exist; the in-browser store remains the source of data.
- No authentication: nothing is protected yet.
