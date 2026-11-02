# DevFlow API — Frontend Integration Guide

> **For:** the frontend ([`dev-flow`](https://github.com/JohnReySeguma/dev-flow)).
> **Accurate for:** `v0.3.0`. Updated at every release (see [`FRONTEND_HANDOFF.md`](FRONTEND_HANDOFF.md)).
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

| Where                              | Difference                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `UserProfile` (`/auth/me`, `/me`)  | No `presence` yet: it arrives with realtime in `v0.6.0`. Treat the signed-in user as `online` until then. |
| `UserProfile`, later `TeamMember`  | The avatar field is `gradient`, as in `lib/members.ts`, not the brief's `avatarColor`.                    |
| `UserProfile.id`, `AccessToken.id` | UUIDs instead of the fixtures' `u-jr` / `pat_01` style ids.                                               |

## 2. Endpoint coverage matrix

**Since** is the first release that serves the endpoint; blank means not yet available.

### Board, backlog and project data — `lib/tracker/store.ts`

| Frontend function             | UI action                             | Endpoint                                                                                | Since |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- | ----- |
| `useTracker()` (initial data) | Load the app / a project              | `GET /bootstrap`, `GET /projects/:key/snapshot`                                         |       |
| `createIssue`                 | Create Issue dialog, quick add        | `POST /projects/:key/issues`                                                            |       |
| `updateIssue`                 | Issue sheet field edits               | `PATCH /issues/:issueKey`                                                               |       |
| `moveIssueToStatus`           | Drag card between board columns       | `POST /issues/:issueKey/move`                                                           |       |
| `moveIssueToSprint`           | Backlog drag, "Move to" menu, ranking | `POST /issues/:issueKey/move`                                                           |       |
| `deleteIssue`                 | Issue sheet → Delete                  | `DELETE /issues/:issueKey`                                                              |       |
| `createSprint`                | Backlog → "+ Sprint"                  | `POST /projects/:key/sprints`                                                           |       |
| `updateSprint`                | Edit sprint name & goal               | `PATCH /sprints/:id`                                                                    |       |
| `deleteSprint`                | Delete planned sprint                 | `DELETE /sprints/:id`                                                                   |       |
| `startSprint`                 | Start sprint dialog                   | `POST /sprints/:id/start`                                                               |       |
| `completeSprint`              | Complete sprint dialog                | `POST /sprints/:id/complete`                                                            |       |
| `addStatus`                   | Board "Add column", settings          | `POST /projects/:key/statuses`                                                          |       |
| `updateStatus`                | Rename column, change category        | `PATCH /projects/:key/statuses/:id`                                                     |       |
| `moveStatus`                  | Move column left/right                | `PUT /projects/:key/statuses/order`                                                     |       |
| `deleteStatus`                | Delete column                         | `DELETE /projects/:key/statuses/:id?moveTo=`                                            |       |
| `createProject`               | New project dialog                    | `POST /projects`                                                                        |       |
| `updateProject`               | Project settings → General            | `PATCH /projects/:key`                                                                  |       |
| `deleteProject`               | Project settings → Delete             | `DELETE /projects/:key`                                                                 |       |
| `resetDemoData`               | Workspace settings → Reset demo data  | `POST /workspace/demo/reset` (planned for `v0.4.0`, with the demo projects it restores) |       |
| Reports page                  | Burndown, velocity, history           | `GET /sprints/:id/burndown`, `GET /projects/:key/reports/*`                             |       |

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
  dot-separated path within the body, query or route parameters (e.g. `email`, `scopes.0`); `(root)` means the body
  as a whole (e.g. an empty PATCH). The `message`s are written to be shown next to the field.

### Error catalogue

Codes are stable: new ones may be added, existing ones are never renamed or repurposed. "Reserved" codes are part of
the contract already but no endpoint returns them yet.

| Code                     | HTTP | Meaning                                                                         | Returned by                                                            |
| ------------------------ | ---- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `BAD_REQUEST`            | 400  | The body is not valid JSON                                                      | Any endpoint with a JSON body                                          |
| `RESET_TOKEN_INVALID`    | 400  | The reset link is unknown, already used or expired; request a new one           | `POST /auth/password/reset`                                            |
| `INVITE_INVALID`         | 400  | The invite link is unknown, used, replaced by a resend or expired               | `GET /invites/:token`, `POST /invites/:token/accept` (new in `v0.3.0`) |
| `UNAUTHENTICATED`        | 401  | Not signed in (or the session was revoked); redirect to `/login`                | Every authenticated endpoint, `POST /auth/refresh`                     |
| `TOKEN_EXPIRED`          | 401  | Access token expired; call `POST /auth/refresh` once and retry                  | Every cookie-authenticated endpoint                                    |
| `INVALID_CREDENTIALS`    | 401  | Wrong email or password (same answer for unknown emails)                        | `POST /auth/login`                                                     |
| `FORBIDDEN`              | 403  | Not allowed: role too low, cross-site write, or a token on a session-only route | Every write (origin check), admin routes, `PATCH /me`, `/me/tokens`    |
| `CANNOT_CHANGE_OWN_ROLE` | 403  | Admins cannot change their own role                                             | `PATCH /workspace/members/:id`                                         |
| `CANNOT_REMOVE_SELF`     | 403  | Admins cannot remove themselves                                                 | `DELETE /workspace/members/:id` (new in `v0.3.0`)                      |
| `NOT_FOUND`              | 404  | Unknown route or resource                                                       | Any unknown route, `DELETE /me/tokens/:id`, disabled OAuth provider    |
| `EMAIL_TAKEN`            | 409  | Sign-up with an email that already has an account                               | `POST /auth/signup`                                                    |
| `PROJECT_KEY_TAKEN`      | 409  | Project key already in use                                                      | Reserved (`v0.4.0`)                                                    |
| `SPRINT_ALREADY_ACTIVE`  | 409  | Another sprint is active in the project                                         | Reserved (`v0.5.0`)                                                    |
| `SPRINT_NOT_PLANNED`     | 409  | Only planned sprints can be started or deleted                                  | Reserved (`v0.5.0`)                                                    |
| `STATUS_DELETE_BLOCKED`  | 409  | Deleting would break the workflow guards                                        | Reserved (`v0.4.0`)                                                    |
| `LAST_ADMIN`             | 409  | The last active admin cannot be demoted or removed                              | `PATCH` / `DELETE /workspace/members/:id`                              |
| `ALREADY_MEMBER`         | 409  | The email is already a member or already invited                                | `POST /workspace/invites`, `POST /invites/:token/accept`               |
| `CONFLICT_STALE`         | 412  | `If-Match` no longer matches; re-fetch and retry                                | `PATCH /me`                                                            |
| `PAYLOAD_TOO_LARGE`      | 413  | Body larger than 100 kB                                                         | Any endpoint with a JSON body                                          |
| `VALIDATION_FAILED`      | 422  | Invalid fields, listed in `errors`                                              | Every endpoint with input                                              |
| `RATE_LIMITED`           | 429  | Too many requests; retry later                                                  | Reserved (`v1.0.0`)                                                    |
| `INTERNAL_ERROR`         | 500  | Unexpected failure; quote `requestId` when reporting                            | Any endpoint                                                           |
| `EMAIL_DELIVERY_FAILED`  | 502  | The email could not be sent; the invite is saved, offer Resend                  | `POST /workspace/invites`, `.../resend` (new in `v0.3.0`)              |

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
that needs the session therefore lives under `/api/v1`, including the realtime endpoint (§6).

### 5.3 Expiry and refresh

1. A request answers `401` with `code: "TOKEN_EXPIRED"`.
2. Call `POST /auth/refresh` (no body). `204` → both cookies were rotated; retry the original request once.
3. Refresh answers `401 UNAUTHENTICATED` → signed out (the API also clears the cookies): redirect to `/login`.

**Run at most one refresh at a time.** Each refresh token works once; presenting a used one is treated as theft and
revokes the whole session. If several requests hit `TOKEN_EXPIRED` together (or several tabs are open), share one
in-flight refresh promise and retry them all after it settles.

Any other `401` means signed out. `POST /auth/logout` (`204`) revokes the session and clears the cookies; it also
succeeds when already signed out. A password reset signs the account out on every device.

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
expire after 60 minutes, and only the newest one works. Passwords are 8–128 characters.

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
`GET /me`) but cannot change the profile or manage tokens (`403 FORBIDDEN`). Scopes are stored and returned; they gate
the issue and project endpoints as those arrive (`v0.4.0`+).

### 5.9 Roles and permissions

`GET /auth/me` and `GET /workspace` return the caller's role. Hide or disable what the role cannot do; the API enforces
it anyway with `403 FORBIDDEN`.

| Action                                               | viewer | member | admin |
| ---------------------------------------------------- | ------ | ------ | ----- |
| Read the workspace, members and invites              | ✓      | ✓      | ✓     |
| Edit issues and sprints (from `v0.4.0`)              |        | ✓      | ✓     |
| Invite, change roles, remove members, revoke invites |        |        | ✓     |
| Workflow, project delete (from `v0.4.0`)             |        |        | ✓     |

- Roles are read from the database on every request: a demotion applies to the member's very next request.
- Member management also needs a signed-in session: access tokens get `403` even for an admin.
- Admins cannot change their own role (`CANNOT_CHANGE_OWN_ROLE`) or remove themselves (`CANNOT_REMOVE_SELF`), and the
  last active admin cannot be demoted or removed (`LAST_ADMIN`), matching the frontend's existing locks.
- Removing a member is immediate and deletes the account with its sessions and tokens. The frontend's current
  "Undo" cannot be honoured server-side: either confirm before removing, or delay the request until the undo window
  closes. Revoking an invite can be undone by inviting again.
- Role changes are last-write-wins (no `If-Match` on members).

## 6. Realtime

Ships in `v0.6.0`. No events yet. Decided so far: Socket.IO is mounted at **`/api/v1/socket.io`** (not the default
`/socket.io`) so the handshake carries the `/api/v1`-scoped session cookie. Connect with:

```ts
io("http://localhost:4000/realtime", { path: "/api/v1/socket.io", withCredentials: true });
```

## 7. Demo data and accounts

When `SEED_DEMO_DATA=true`, an empty database is seeded with the Acme Inc workspace and the frontend's team
(`lib/account-data.ts`). Every demo account uses the password **`devflow-demo`**:

| Role   | Email                  | Person       |
| ------ | ---------------------- | ------------ |
| admin  | `demo@devflow.local`   | John Rey     |
| member | `member@devflow.local` | Dmitri Kovac |
| viewer | `viewer@devflow.local` | Lucas Brandt |

Aiko Mori (`aiko@acme.dev`, admin) and Priya Shah (`priya@acme.dev`, member) exist too. The admin owns the
frontend's two example access tokens; their secrets were never issued, so they cannot authenticate. The projects
DEV, BIL and MOB arrive in `v0.4.0`.

## 8. Known limitations

- No project, issue or sprint endpoints yet: keep the in-browser store for data.
- Roles are enforced on the workspace endpoints; issue, sprint and project permissions arrive with those endpoints.
- No rate limits on sign-in, sign-up, password reset or invites until `v1.0.0`.
- Signing up directly with an invited email leaves the invite pending (accepting it then answers `ALREADY_MEMBER`);
  revoke it from the members list.
- `POST /workspace/demo/reset` is not available yet; it arrives in `v0.4.0` with the demo projects it restores.
- `lastActiveAt` is updated on sign-in and on each refresh (about every 15 minutes of activity), not on every request.
