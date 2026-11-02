# DevFlow API — Frontend Integration Guide

> **For:** the frontend ([`dev-flow`](https://github.com/JohnReySeguma/dev-flow)).
> **Accurate for:** `v0.6.0`. Updated at every release (see [`FRONTEND_HANDOFF.md`](FRONTEND_HANDOFF.md)).
> **Machine-readable contract:** [`openapi.json`](openapi.json), also served at `/api/v1/openapi.json`, with
> Swagger UI at `/api/v1/docs`.
> **Step-by-step plan for the frontend:** [`FRONTEND_BRIEF.md`](FRONTEND_BRIEF.md).

---

## 1. Conventions

| Topic       | Contract                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL    | `http://localhost:4000/api/v1` (development and Docker)                                                                                                    |
| JSON        | camelCase, field names and enum values identical to the frontend's types (deviations in §1.1)                                                              |
| Timestamps  | ISO 8601 UTC strings, e.g. `2026-11-01T09:00:00.000Z`                                                                                                      |
| CORS        | Only `CORS_ORIGIN` (default `http://localhost:3000`), with credentials. Send `credentials: "include"` on every request.                                    |
| Request id  | Every response carries `X-Request-Id`; error bodies repeat it as `requestId`. You may send your own `X-Request-Id` (≤ 128 chars of `A–Z a–z 0–9 _ . : -`). |
| Errors      | RFC 9457 `application/problem+json` with a stable `code` (§4)                                                                                              |
| Lists       | `?limit=50&cursor=…` (limit 1–100, default 50) → `{ items, nextCursor }`; `nextCursor` is `null` on the last page. Cursors are opaque.                     |
| Concurrency | Resources you can PATCH return an `ETag`. Send it back as `If-Match` to get `412 CONFLICT_STALE` instead of overwriting a newer change. Optional.          |

### 1.1 Deliberate differences from the frontend types

| Where                             | Difference                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `UserProfile`, `TeamMember`       | No `presence` field: who is online comes from Live Sync's `presence.updated` (§7.2), per project.                                   |
| `UserProfile`, later `TeamMember` | The avatar field is `gradient`, as in `lib/members.ts`, not the brief's `avatarColor`.                                              |
| Every `id` except issues          | UUIDs instead of the fixtures' `u-jr`, `p-dev`, `dev-todo`, `s-p-dev-25`, `pat_01` style ids.                                       |
| `Issue.id`                        | The issue key (`DEV-104`), as in `types.ts`. Keys are never zero-padded: the fixtures' `DEV-088` is `DEV-88` (lookups accept both). |
| `Issue.git`, `Issue.dueAt`        | Omitted when absent, as their `?` in `types.ts` allows; never `null`.                                                               |
| `ProjectSummary` (`/projects`)    | A `Project` plus `activeSprint`, `backlogCount` and `lead`, for the sidebar and Projects overview.                                  |

## 2. Endpoint coverage matrix

**Since** is the first release that serves the endpoint; blank means not yet available.

### Board, backlog and project data — `lib/tracker/store.ts`

| Frontend function             | UI action                             | Endpoint                                                      | Since |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------- | ----- |
| `useTracker()` (initial data) | Load the app / a project              | `GET /bootstrap`, `GET /projects/:key/snapshot`               | 0.4.0 |
| `createIssue`                 | Create Issue dialog, quick add        | `POST /projects/:key/issues`                                  | 0.4.0 |
| `updateIssue`                 | Issue sheet field edits               | `PATCH /issues/:issueKey`                                     | 0.4.0 |
| `moveIssueToStatus`           | Drag card between board columns       | `POST /issues/:issueKey/move`                                 | 0.4.0 |
| `moveIssueToSprint`           | Backlog drag, "Move to" menu, ranking | `POST /issues/:issueKey/move`                                 | 0.4.0 |
| `deleteIssue`                 | Issue sheet → Delete                  | `DELETE /issues/:issueKey`                                    | 0.4.0 |
| `createSprint`                | Backlog → "+ Sprint"                  | `POST /projects/:key/sprints`                                 | 0.5.0 |
| `updateSprint`                | Edit sprint name & goal               | `PATCH /sprints/:id`                                          | 0.5.0 |
| `deleteSprint`                | Delete planned sprint                 | `DELETE /sprints/:id`                                         | 0.5.0 |
| `startSprint`                 | Start sprint dialog                   | `POST /sprints/:id/start`                                     | 0.5.0 |
| `completeSprint`              | Complete sprint dialog                | `POST /sprints/:id/complete`                                  | 0.5.0 |
| `addStatus`                   | Board "Add column", settings          | `POST /projects/:key/statuses`                                | 0.4.0 |
| `updateStatus`                | Rename column, change category        | `PATCH /projects/:key/statuses/:id`                           | 0.4.0 |
| `moveStatus`                  | Move column left/right                | `PUT /projects/:key/statuses/order` (send the full new order) | 0.4.0 |
| `deleteStatus`                | Delete column                         | `DELETE /projects/:key/statuses/:id?moveTo=`                  | 0.4.0 |
| `createProject`               | New project dialog                    | `POST /projects`                                              | 0.4.0 |
| `updateProject`               | Project settings → General            | `PATCH /projects/:key`                                        | 0.4.0 |
| `deleteProject`               | Project settings → Delete             | `DELETE /projects/:key`                                       | 0.4.0 |
| `resetDemoData`               | Workspace settings → Reset demo data  | `POST /workspace/demo/reset`                                  | 0.4.0 |
| Reports page                  | Burndown, velocity, history           | `GET /sprints/:id/burndown`, `GET /projects/:key/reports/*`   | 0.5.0 |
| Issue sheet comments          | Read and add comments                 | `GET`/`POST /issues/:issueKey/comments`                       | 0.4.0 |
| ⌘K jump                       | Open an issue by key or number        | `GET /issues/:issueKey` (`104` needs `?project=DEV`)          | 0.4.0 |
| Live Sync, presence avatars   | Teammates' changes appear live        | Socket.IO `/realtime` at `/api/v1/socket.io` (§7)             | 0.6.0 |
| Issue card / sheet git badge  | PR or commit linked from GitHub       | `Issue.git`, set by GitHub webhooks (§7.5)                    | 0.6.0 |

### Account and workspace

| Frontend component                     | UI action                        | Endpoint                                                        | Since |
| -------------------------------------- | -------------------------------- | --------------------------------------------------------------- | ----- |
| App load                               | Session check                    | `GET /auth/me`                                                  | 0.2.0 |
| `components/auth/auth-form.tsx`        | Sign in / sign up                | `POST /auth/login`, `POST /auth/signup`                         | 0.2.0 |
| `auth-form.tsx`                        | Forgot password                  | `POST /auth/password/forgot`                                    | 0.2.0 |
| New `/reset-password` page             | Choose a new password            | `POST /auth/password/reset`                                     | 0.2.0 |
| `auth-form.tsx` OAuth buttons          | Show / hide providers            | `GET /config`                                                   | 0.1.0 |
| `auth-form.tsx` OAuth buttons          | Continue with GitHub / Google    | `GET /auth/oauth/:provider` (browser navigation)                | 0.2.0 |
| API client                             | Renew an expired access token    | `POST /auth/refresh`                                            | 0.2.0 |
| `components/layout/app-sidebar.tsx`    | Log out                          | `POST /auth/logout`                                             | 0.2.0 |
| `components/profile/profile-view.tsx`  | Load / save personal settings    | `GET /me`, `PATCH /me`                                          | 0.2.0 |
| `components/profile/access-tokens.tsx` | List / generate / revoke tokens  | `GET /me/tokens`, `POST /me/tokens`, `DELETE /me/tokens/:id`    | 0.2.0 |
| `components/settings/team-members.tsx` | List members and pending invites | `GET /workspace/members`                                        | 0.3.0 |
| `team-members.tsx`                     | Invite / resend invite           | `POST /workspace/invites`, `POST /workspace/invites/:id/resend` | 0.3.0 |
| `team-members.tsx`                     | Change role                      | `PATCH /workspace/members/:id`                                  | 0.3.0 |
| `team-members.tsx`                     | Remove member / revoke invite    | `DELETE /workspace/members/:id`                                 | 0.3.0 |
| Settings header, permissions           | Workspace name and your role     | `GET /workspace`                                                | 0.3.0 |
| New `/invite` page                     | Preview and accept an invite     | `GET /invites/:token`, `POST /invites/:token/accept`            | 0.3.0 |

### Operational

| Endpoint                            | Purpose                                               | Since |
| ----------------------------------- | ----------------------------------------------------- | ----- |
| `GET /health`                       | Liveness, `{ status: "ok" }`                          | 0.1.0 |
| `GET /health/ready`                 | Readiness: `200` / `503` with per-dependency `checks` | 0.1.0 |
| `GET /openapi.json`                 | OpenAPI 3.1 document                                  | 0.1.0 |
| `GET /docs`                         | Swagger UI                                            | 0.1.0 |
| `POST /integrations/github/webhook` | GitHub App deliveries (called by GitHub)              | 0.6.0 |

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
  dot-separated path within the body, query or route parameters (e.g. `email`, `scopes.0`); `(root)` means the body
  as a whole (e.g. an empty PATCH). The `message`s are written to be shown next to the field.

### Error catalogue

Codes are stable: new ones may be added, existing ones are never renamed or repurposed. "Reserved" codes are part of
the contract already but no endpoint returns them yet.

| Code                        | HTTP | Meaning                                                                         | Returned by                                                            |
| --------------------------- | ---- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `BAD_REQUEST`               | 400  | The body is not valid JSON                                                      | Any endpoint with a JSON body, the GitHub webhook                      |
| `RESET_TOKEN_INVALID`       | 400  | The reset link is unknown, already used or expired; request a new one           | `POST /auth/password/reset`                                            |
| `INVITE_INVALID`            | 400  | The invite link is unknown, used, replaced by a resend or expired               | `GET /invites/:token`, `POST /invites/:token/accept` (new in `v0.3.0`) |
| `UNAUTHENTICATED`           | 401  | Not signed in (or the session was revoked); redirect to `/login`                | Every authenticated endpoint, `POST /auth/refresh`                     |
| `TOKEN_EXPIRED`             | 401  | Access token expired; call `POST /auth/refresh` once and retry                  | Every cookie-authenticated endpoint                                    |
| `INVALID_CREDENTIALS`       | 401  | Wrong email or password (same answer for unknown emails)                        | `POST /auth/login`                                                     |
| `WEBHOOK_SIGNATURE_INVALID` | 401  | `X-Hub-Signature-256` missing or wrong (GitHub only, never the frontend)        | `POST /integrations/github/webhook` (new in `v0.6.0`)                  |
| `FORBIDDEN`                 | 403  | Not allowed: role too low, cross-site write, or a token on a session-only route | Every write (origin check), admin routes, `PATCH /me`, `/me/tokens`    |
| `CANNOT_CHANGE_OWN_ROLE`    | 403  | Admins cannot change their own role                                             | `PATCH /workspace/members/:id`                                         |
| `CANNOT_REMOVE_SELF`        | 403  | Admins cannot remove themselves                                                 | `DELETE /workspace/members/:id` (new in `v0.3.0`)                      |
| `NOT_FOUND`                 | 404  | Unknown route or resource                                                       | Any unknown route or resource, disabled OAuth provider or GitHub App   |
| `EMAIL_TAKEN`               | 409  | Sign-up with an email that already has an account                               | `POST /auth/signup`                                                    |
| `PROJECT_KEY_TAKEN`         | 409  | Project key already in use                                                      | `POST /projects`                                                       |
| `SPRINT_ALREADY_ACTIVE`     | 409  | Another sprint is active in the project; complete it first                      | `POST /sprints/:id/start`                                              |
| `SPRINT_NOT_PLANNED`        | 409  | Only planned sprints can be started or deleted                                  | `POST /sprints/:id/start`, `DELETE /sprints/:id`                       |
| `SPRINT_NOT_ACTIVE`         | 409  | Only the active sprint can be completed                                         | `POST /sprints/:id/complete` (new in `v0.5.0`)                         |
| `STATUS_DELETE_BLOCKED`     | 409  | Deleting would leave < 2 statuses or no to-do / done status (`detail` says why) | `DELETE /projects/:key/statuses/:id`                                   |
| `STATUS_UPDATE_BLOCKED`     | 409  | Recategorising would leave no to-do or no done status (`detail` says why)       | `PATCH /projects/:key/statuses/:id` (new in `v0.4.0`)                  |
| `LAST_ADMIN`                | 409  | The last active admin cannot be demoted or removed                              | `PATCH` / `DELETE /workspace/members/:id`                              |
| `ALREADY_MEMBER`            | 409  | The email is already a member or already invited                                | `POST /workspace/invites`, `POST /invites/:token/accept`               |
| `CONFLICT_STALE`            | 412  | `If-Match` no longer matches; re-fetch and retry                                | `PATCH /me`, `PATCH /projects/:key`, `PATCH /issues/:issueKey`         |
| `PAYLOAD_TOO_LARGE`         | 413  | Body larger than 100 kB                                                         | Any endpoint with a JSON body                                          |
| `VALIDATION_FAILED`         | 422  | Invalid fields, listed in `errors`                                              | Every endpoint with input                                              |
| `RATE_LIMITED`              | 429  | Too many requests; retry later                                                  | Reserved (`v1.0.0`)                                                    |
| `INTERNAL_ERROR`            | 500  | Unexpected failure; quote `requestId` when reporting                            | Any endpoint                                                           |
| `EMAIL_DELIVERY_FAILED`     | 502  | The email could not be sent; the invite is saved, offer Resend                  | `POST /workspace/invites`, `.../resend` (new in `v0.3.0`)              |

## 5. Authentication

### 5.1 Session check

Call `GET /auth/me` on app load:

- `200` → `{ user: UserProfile, workspace: { id, name } }`; `user.role` is `admin`, `member` or `viewer`.
- `401 UNAUTHENTICATED` → signed out: redirect to `/login`.
- `401 TOKEN_EXPIRED` → refresh (§5.3) and retry once.

`POST /auth/signup` (`201`) and `POST /auth/login` (`200`) return the same body and set the session cookies.
New accounts join the workspace as **member**; only the first account of an empty workspace becomes admin.

### 5.2 Cookies

The browser never sees the tokens: both cookies are `HttpOnly; Secure; SameSite=Lax` and are set and cleared by the
API. Nothing to store in `localStorage`; just send `credentials: "include"`.

| Cookie            | Path                 | Contains                             | Lifetime                                                                                        |
| ----------------- | -------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `devflow_access`  | `/api/v1`            | Access JWT, valid for **15 minutes** | Cookie kept for the session, so an expired JWT still reaches the API and yields `TOKEN_EXPIRED` |
| `devflow_refresh` | `/api/v1/auth`       | Rotating refresh token               | The session: **30 days** from sign-in, not extended by use                                      |
| `devflow_oauth`   | `/api/v1/auth/oauth` | OAuth state, during sign-in only     | 10 minutes                                                                                      |

`localhost:3000` and `localhost:4000` are the same site, so the cookies flow between them. Chrome and Firefox accept
`Secure` cookies on `http://localhost`; if your browser does not, use one of those for local development.

The access cookie is deliberately scoped to `/api/v1`, so the frontend's own server never receives it. Everything
that needs the session therefore lives under `/api/v1`, including the realtime endpoint (§7).

### 5.3 Expiry and refresh

1. A request answers `401` with `code: "TOKEN_EXPIRED"`.
2. Call `POST /auth/refresh` (no body). `204` → both cookies were rotated; retry the original request once.
3. Refresh answers `401 UNAUTHENTICATED` → signed out (the API also clears the cookies): redirect to `/login`.

**Run at most one refresh at a time.** Each refresh token works once; presenting a used one is treated as theft and
revokes the whole session. If several requests hit `TOKEN_EXPIRED` together (or several tabs are open), share one
in-flight refresh promise and retry them all after it settles.

Any other `401` means signed out. `POST /auth/logout` (`204`) revokes the session and clears the cookies; it also
succeeds when already signed out. A password reset signs the account out on every device and deletes its access
tokens.

### 5.4 CSRF

No token or header to manage. Writes (`POST`, `PUT`, `PATCH`, `DELETE`) must carry the browser's `Origin` header equal
to `CORS_ORIGIN`, which browsers add automatically; together with `SameSite=Lax` cookies this blocks cross-site
requests. A write from another origin gets `403 FORBIDDEN`. Requests with `Authorization: Bearer` are exempt.

### 5.5 OAuth (GitHub, Google)

Show a provider only when `GET /config` reports it enabled. To sign in, **navigate the browser** (not `fetch`) to:

```
http://localhost:4000/api/v1/auth/oauth/github?redirect=/projects
```

- `redirect` must be a relative path on the frontend (default `/projects`); anything else falls back to `/projects`.
- Success → redirect to `${CORS_ORIGIN}${redirect}`, signed in.
- Failure → redirect to `${CORS_ORIGIN}/login?error=<code>`:

| `error`                  | Meaning                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `oauth_denied`           | The user cancelled on the provider's consent screen                           |
| `oauth_state_mismatch`   | The sign-in link expired (10 min) or was tampered with: start again           |
| `oauth_email_unverified` | The provider account has no verified email, so it cannot be linked or created |
| `oauth_failed`           | The provider could not be reached or rejected the request: try again          |

Accounts are matched by provider identity first, then by verified email (an existing password account gets the
provider linked), otherwise a member account is created. The callback URLs registered with the providers are
`${API_URL}/api/v1/auth/oauth/{github,google}/callback`.

### 5.6 Password reset

`POST /auth/password/forgot { email }` always answers `202`, whether or not the account exists. The email links to:

```
${CORS_ORIGIN}/reset-password?token=<token>
```

The new `/reset-password` page reads `token` and calls `POST /auth/password/reset { token, password }`:
`204` → show "Password changed, sign in"; `400 RESET_TOKEN_INVALID` → offer to request a new link. Links work once,
expire after 60 minutes, and only the newest one works. Passwords are 8–128 characters. A reset also revokes every
session and **deletes the account's personal access tokens**: say so on the success screen ("Create new access
tokens for scripts and the CLI").

### 5.7 Invites

Admins invite with `POST /workspace/invites { email, role }` (`201` → the pending `TeamMember`). The email links to:

```
${CORS_ORIGIN}/invite?token=<token>
```

The new `/invite` page reads `token`, shows `GET /invites/:token` (`{ email, role, workspace: { name }, invitedBy, expiresAt }`)
and submits `POST /invites/:token/accept { name, password }`: `201` → the account exists with the invited role and is
signed in (same body and cookies as `/auth/signup`), so continue to `/projects`. Both answer `400 INVITE_INVALID` for a
link that is unknown, already used, replaced by a resend or older than 7 days, and accept answers
`409 ALREADY_MEMBER` if the email already has an account (send the user to sign in).

`POST /workspace/invites/:id/resend` emails a fresh link; the previous link stops working. Inviting an email that is
already a member or already invited answers `409 ALREADY_MEMBER`. If the email cannot be sent, the API answers
`502 EMAIL_DELIVERY_FAILED` but keeps the invite, so show the error and offer Resend instead of "Invite sent".

### 5.8 Personal access tokens

`POST /me/tokens { name, scopes, expiresInDays }` returns `{ token, secret }`. **The secret is shown once**; afterwards
only `lastFour` is available. Clients use it as `Authorization: Bearer dfp_…`. A token can read (`GET /auth/me`,
`GET /me`) but cannot change the profile or manage tokens (`403 FORBIDDEN`). Scopes gate what else a token may do;
signed-in sessions are not scoped:

| Scope             | Allows                                                                               |
| ----------------- | ------------------------------------------------------------------------------------ |
| `issues:read`     | Read projects, issues, comments, snapshots and `/bootstrap`                          |
| `issues:write`    | Create, update, move and delete issues; comment                                      |
| `projects:admin`  | Create, update and delete projects; edit workflows (the caller's role still applies) |
| `webhooks:manage` | Reserved; GitHub deliveries authenticate with their signature, not a token           |

### 5.9 Roles and permissions

`GET /auth/me` and `GET /workspace` return the caller's role. Hide or disable what the role cannot do; the API enforces
it anyway with `403 FORBIDDEN`.

| Action                                                          | viewer | member | admin |
| --------------------------------------------------------------- | ------ | ------ | ----- |
| Read the workspace, members and invites                         | ✓      | ✓      | ✓     |
| Read projects, issues, comments                                 | ✓      | ✓      | ✓     |
| Create and edit issues and comments; create and rename projects |        | ✓      | ✓     |
| Create, edit, start, complete and delete sprints                |        | ✓      | ✓     |
| Invite, change roles, remove members, revoke invites            |        |        | ✓     |
| Edit the workflow, delete projects, reset demo data             |        |        | ✓     |

- Roles are read from the database on every request: a demotion applies to the member's very next request.
- Member management also needs a signed-in session: access tokens get `403` even for an admin.
- Admins cannot change their own role (`CANNOT_CHANGE_OWN_ROLE`) or remove themselves (`CANNOT_REMOVE_SELF`), and the
  last active admin cannot be demoted or removed (`LAST_ADMIN`), matching the frontend's existing locks.
- Removing a member is immediate and deletes the account with its sessions and tokens. The frontend's current
  "Undo" cannot be honoured server-side: either confirm before removing, or delay the request until the undo window
  closes. Revoking an invite can be undone by inviting again.
- Role changes are last-write-wins (no `If-Match` on members).

## 6. Projects, workflow and issues

### 6.1 Loading

Call `GET /bootstrap` once after sign-in (`{ me, workspace, config, projects }`, with each project's summary), then
`GET /projects/:key/snapshot` per project: `{ project, sprints, issues }` where `project.workflow` is in board order,
`sprints` are all sprints by number (completed ones carry `report`), and `issues` are the backlog and planned/active
sprints in **rank order**, the array order the store already uses. Neither is paginated; `GET /projects/:key/issues`
offers filtered, paginated access (`sprint=<id>|backlog|active`, `assignee=<id>|none`, `priority`, `type`, `q`,
`mine=true`).

### 6.2 Issues

- Keys come from a per-project counter (`DEV-134`, never reused). `GET /issues/:issueKey` accepts any case and
  `DEV-088`-style padding; a bare `104` needs `?project=DEV`. All issue endpoints take the key, never the UUID.
- `POST /projects/:key/issues` puts the issue at the top of the ranking, like `createIssue`. Omitted fields default to
  `type: task`, `priority: medium`, no assignee, estimate or sprint, and the first to-do status.
- `resolvedAt` is managed by the API: set when an issue enters a done-category status, cleared when it leaves. Don't
  send it. `tags`, `dueAt` and `git` are read-only, as in the store (`git` is set by GitHub, §7.5).
- `PATCH /issues/:issueKey` and `PATCH /projects/:key` return an `ETag`; send `If-Match` to get `412` instead of
  overwriting a teammate's change.

### 6.3 Moving and ranking

`POST /issues/:issueKey/move { statusId?, sprintId?, beforeIssueKey? }` replaces `moveIssueToStatus` and
`moveIssueToSprint` and returns the moved issue:

| Request                              | Result (as the store does today)         |
| ------------------------------------ | ---------------------------------------- |
| `{ statusId }`                       | New column; the issue floats to the top  |
| `{ sprintId }` (or `null` = backlog) | New container; the issue goes to the end |
| `{ …, beforeIssueKey: "DEV-121" }`   | Placed directly before DEV-121           |

Only the moved issue changes; other issues keep their positions. Re-fetching the snapshot gives the new order.

### 6.4 Workflow

Admins edit columns with `POST /projects/:key/statuses` (inserted before the first done status, unless it is done),
`PATCH …/:id`, `PUT …/order { statusIds }` (the store's `moveStatus` swaps neighbours: send the resulting full order)
and `DELETE …/:id?moveTo=<statusId>` (`moveTo` is required when the column has issues). Each answers with the whole
`Project`, so replace the cached workflow with `project.workflow`. Guards match `cannotDeleteStatusReason`.

### 6.5 Sprints

Members and admins run the lifecycle; every call answers with the frontend's `Sprint`:

| Store function   | Endpoint                                               | Rules                                                                               |
| ---------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `createSprint`   | `POST /projects/:key/sprints` (no body)                | Creates `Sprint {n+1}`, planned                                                     |
| `updateSprint`   | `PATCH /sprints/:id { name?, goal? }`                  | Any status                                                                          |
| `deleteSprint`   | `DELETE /sprints/:id`                                  | Planned only (`SPRINT_NOT_PLANNED`); its issues return to the backlog               |
| `startSprint`    | `POST /sprints/:id/start { name, goal, durationDays }` | Planned only; one active sprint per project (`SPRINT_ALREADY_ACTIVE`); 1 to 28 days |
| `completeSprint` | `POST /sprints/:id/complete { carryOver }`             | Active only (`SPRINT_NOT_ACTIVE`); `carryOver` is the store's `CarryOver`           |

Starting snapshots `committedPoints`. Completing writes `report`, sets `completedAt` and moves every issue not in a
done status to the backlog, a planned sprint (`{ kind: "sprint", sprintId }`) or a sprint it creates
(`{ kind: "new-sprint" }`), all in one transaction. The response is `{ sprint, carriedOverTo }`: `carriedOverTo` is the
sprint that received the issues (the new one for `new-sprint`), or `null` for the backlog. Re-fetch the snapshot
afterwards to pick up the moved issues. `GET /projects/:key/sprints?status=planned,active` lists sprints by number.

### 6.6 Reports

| Report   | Endpoint                                      | Shape                                                               |
| -------- | --------------------------------------------- | ------------------------------------------------------------------- |
| Burndown | `GET /sprints/:id/burndown`                   | `{ sprintId, committedPoints, days: [{ date, ideal, remaining }] }` |
| Velocity | `GET /projects/:key/reports/velocity?limit=8` | `[{ sprintId, name, committed, completed }]`, oldest first          |
| History  | `GET /projects/:key/reports/history`          | `{ items: Sprint[], nextCursor }`, completed sprints newest first   |

`days` has one point per sprint day, exactly the `BurndownDay[]` the reports view builds today, so it can be passed
to `BurndownChart` as is. The difference is where `remaining` comes from: the issue history rather than today's
`resolvedAt` values, so issues added, removed, re-estimated or reopened mid-sprint are counted correctly. `ideal`
starts from `committedPoints`; `remaining` is `null` for days still ahead. A planned sprint has no days.

## 7. Realtime (Live Sync) and GitHub

### 7.1 Connecting

Socket.IO 4, namespace **`/realtime`**, mounted at **`/api/v1/socket.io`** (not the default `/socket.io`) so the
handshake carries the `/api/v1`-scoped session cookie:

```ts
import { io } from "socket.io-client";

const socket = io("http://localhost:4000/realtime", { path: "/api/v1/socket.io", withCredentials: true });
// Scripts and the CLI: io(url, { path, auth: { token: "dfp_…" } }) — joining needs the issues:read scope.
```

- The handshake is authenticated once, with the session cookie or a personal access token, and must come from
  `CORS_ORIGIN` (other origins are refused).
- A refused connection fires `connect_error` with the REST error code in `err.data.code`:

  ```ts
  socket.on("connect_error", async (err) => {
    const code = (err as Error & { data?: { code?: string } }).data?.code;
    if (code === "TOKEN_EXPIRED") {
      await refresh(); // POST /auth/refresh, the same single-flight refresh as the API client (§5.3)
      socket.connect();
    } else if (code === "UNAUTHENTICATED") {
      // signed out: stop reconnecting and go to /login
    }
  });
  ```

- An open connection is not cut when the access token later expires; it lasts until it disconnects.

### 7.2 Project rooms and presence

Events are sent per project. Join the projects the user is looking at (or every project from `/bootstrap`):

```ts
socket.emit("project:join", "DEV", (res) => {
  // { ok: true, projectKey: "DEV" } or { ok: false, code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION_FAILED", message }
});
socket.emit("project:leave", "DEV");
```

Rooms are not remembered across reconnects: **re-join on every `connect`**, then re-fetch
`GET /projects/:key/snapshot`, because events sent while disconnected are not replayed.

`presence.updated` is sent to the room whenever someone joins, leaves or disconnects. `online` lists the user ids
(`TeamMember.id`) with at least one tab in the room, the joining user included:

```json
{ "projectKey": "DEV", "actorId": "0193f1c2-…", "online": ["0193f1c2-…", "0193f1c2-…"] }
```

### 7.3 Events

Every payload has `projectKey` and `actorId`: the user who made the change, or `null` for the system (GitHub). The
user who made a change receives its event too: **ignore events whose `actorId` is your own user id**, since the HTTP
response already updated the store. Resources inside payloads have exactly the REST shapes (`Issue`, `Sprint`,
`Project`).

| Event              | Extra fields                        | Apply to the store                                                                  |
| ------------------ | ----------------------------------- | ----------------------------------------------------------------------------------- |
| `issue.created`    | `issue`                             | Insert at the top of the ranking (new issues always rank first)                     |
| `issue.updated`    | `issue`                             | Replace the issue (fields, comment count, `git` link)                               |
| `issue.moved`      | `issue`, `beforeIssueKey`           | Replace it, and re-rank it before `beforeIssueKey` (`null`: last)                   |
| `issue.deleted`    | `issueKey`                          | Remove it                                                                           |
| `sprint.created`   | `sprint`                            | Add it                                                                              |
| `sprint.updated`   | `sprint`                            | Replace it (name, goal)                                                             |
| `sprint.started`   | `sprint`                            | Replace it (now `active`, with dates and `committedPoints`)                         |
| `sprint.completed` | `sprint`, `carriedOverTo`, `issues` | Replace the sprint, add or replace `carriedOverTo` (may be new), replace `issues`   |
| `sprint.deleted`   | `sprintId`, `issues`                | Remove the sprint; replace `issues` (moved to the backlog)                          |
| `workflow.updated` | `project`                           | Replace the project, then re-fetch the snapshot (a deleted status moves its issues) |
| `project.updated`  | `project`                           | Replace the project (name, description, …)                                          |
| `project.deleted`  | —                                   | Remove the project and its data; leave the page if it is open                       |
| `presence.updated` | `online`                            | §7.2                                                                                |

`sprint.completed.issues` are the carried-over issues with their new `sprintId` (`null` for the backlog). Issues
completed in the sprint stay in it and are not repeated.

Examples:

```jsonc
// issue.moved: Dmitri dragged DEV-134 above DEV-104 into "In Progress"
{
  "projectKey": "DEV",
  "actorId": "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e11",
  "issue": { "id": "DEV-134", "statusId": "0193f1c2-…", "sprintId": "0193f1c2-…", "title": "Live!", "…": "…" },
  "beforeIssueKey": "DEV-104"
}

// issue.deleted
{ "projectKey": "DEV", "actorId": "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e11", "issueKey": "DEV-134" }

// sprint.completed with carry-over into a new sprint
{
  "projectKey": "DEV",
  "actorId": "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e11",
  "sprint": { "id": "0193f1c2-…", "name": "Sprint 25", "status": "completed", "report": { "…": "…" } },
  "carriedOverTo": { "id": "0193f1c2-…", "name": "Sprint 27", "status": "planned" },
  "issues": [{ "id": "DEV-118", "sprintId": "0193f1c2-…", "…": "…" }]
}
```

### 7.4 Applying events safely

- Drop events for projects that are not in the store.
- Each event is sent as soon as its change commits. Two changes made at the same moment may arrive in either order,
  and two people editing the same field is still last-write-wins; send `If-Match` (§1) where it matters.
- The snapshot is always authoritative. When in doubt (a reconnect, an event about an issue or sprint the store
  doesn't have), re-fetch it.

### 7.5 GitHub integration

When `GET /config` reports `githubIntegration: true`, GitHub App webhooks
(`POST /integrations/github/webhook`, called by GitHub, never by the frontend) keep `Issue.git` up to date:

- Issue keys are read from pull request titles, branch names (`dev-104-token-refresh`) and commit messages.
- A pull request sets `git: { kind: "pr", number, state }` with `state` `open`, `draft` or `merged`. A merged one also
  moves the issue to the project's first done status (`resolvedAt` set, counted in the burndown). One closed without
  merging removes its own link.
- A commit sets `git: { kind: "commit", sha }` (7 characters), but never replaces a pull request link.
- Each change arrives as `issue.updated`, or `issue.moved` when the status changed, with `actorId: null`. Show it
  as a GitHub change (e.g. "via GitHub").

## 8. Demo data and accounts

When `SEED_DEMO_DATA=true`, an empty database is seeded with the Acme Inc workspace and the frontend's team
(`lib/account-data.ts`). Every demo account uses the password **`devflow-demo`**:

| Role   | Email                  | Person       |
| ------ | ---------------------- | ------------ |
| admin  | `demo@devflow.local`   | John Rey     |
| member | `member@devflow.local` | Dmitri Kovac |
| viewer | `viewer@devflow.local` | Lucas Brandt |

Aiko Mori (`aiko@acme.dev`, admin) and Priya Shah (`priya@acme.dev`, member) exist too. The admin owns the
frontend's two example access tokens; their secrets were never issued, so they cannot authenticate.

The tracker is the frontend's demo (`lib/tracker/seed.ts`): projects **DEV**, **BIL** and **MOB** with the same
workflows, sprints, issues and states, dated relative to the moment the database was seeded, and as many short demo
comments per issue as the frontend shows. `POST /workspace/demo/reset` (admins) restores it at any time without
touching accounts.

## 9. Known limitations

- Deleting an issue also deletes its history, so it disappears from past burndowns.
- Live Sync checks permissions when a socket connects and joins a room: a member who is demoted or removed keeps
  receiving that project's events until their socket disconnects (their next request is refused as usual).
- Live Sync events are not replayed after a disconnect; re-fetch the snapshot after reconnecting (§7.2).
- GitHub is one-way: DevFlow receives webhooks but does not call GitHub's API, so pull requests opened before the App
  was installed are not linked until their next event. The App's private key is required to enable the integration
  but is not used yet.
- No rate limits on sign-in, sign-up, password reset or invites until `v1.0.0`.
- Signing up directly with an invited email leaves the invite pending (accepting it then answers `ALREADY_MEMBER`);
  revoke it from the members list.
- `lastActiveAt` is updated on sign-in and on each refresh (about every 15 minutes of activity), not on every request.
