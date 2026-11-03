# DevFlow API — Frontend Integration Guide

> **For:** the frontend ([`dev-flow`](https://github.com/JohnReySeguma/dev-flow)).
> **Accurate for:** `v2.0.0-beta.4`. Updated at every release (see [`FRONTEND_HANDOFF.md`](FRONTEND_HANDOFF.md)).
> **Machine-readable contract:** [`openapi.json`](openapi.json), also served at `/api/v2/openapi.json`, with
> Swagger UI at `/api/v2/docs`.
> **Step-by-step plan for the frontend:** [`FRONTEND_BRIEF.md`](FRONTEND_BRIEF.md).
>
> **API v2: multiple workspaces.** A user can belong to many workspaces with a different role in each; everything
> except the account itself lives in a workspace, under `/api/v2/workspaces/{slug}/…` (§1.2). `/api/v1` is gone.
> What changed from v1, item by item: `CHANGELOG.md`, `2.0.0-beta.2` → Frontend impact.

---

## 1. Conventions

| Topic       | Contract                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL    | `http://localhost:4000/api/v2` (development and Docker)                                                                                                    |
| Workspaces  | Everything that belongs to a workspace is under `/workspaces/{slug}` (§1.2), e.g. `/api/v2/workspaces/acme-inc/projects`                                   |
| JSON        | camelCase, field names and enum values identical to the frontend's types (deviations in §1.1)                                                              |
| Timestamps  | ISO 8601 UTC strings, e.g. `2026-11-01T09:00:00.000Z`                                                                                                      |
| CORS        | Only `CORS_ORIGIN` (default `http://localhost:3000`), with credentials. Send `credentials: "include"` on every request.                                    |
| Request id  | Every response carries `X-Request-Id`; error bodies repeat it as `requestId`. You may send your own `X-Request-Id` (≤ 128 chars of `A–Z a–z 0–9 _ . : -`). |
| Errors      | RFC 9457 `application/problem+json` with a stable `code` (§4)                                                                                              |
| Lists       | `?limit=50&cursor=…` (limit 1–100, default 50) → `{ items, nextCursor }`; `nextCursor` is `null` on the last page. Cursors are opaque.                     |
| Concurrency | Resources you can PATCH return an `ETag`. Send it back as `If-Match` to get `412 CONFLICT_STALE` instead of overwriting a newer change. Optional.          |
| Headers     | Cross-origin JavaScript can read `ETag`, `X-Request-Id`, `Retry-After`, `RateLimit` and `RateLimit-Policy` (`Access-Control-Expose-Headers`).              |

### 1.1 Deliberate differences from the frontend types

| Where                             | Difference                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `UserProfile`, `TeamMember`       | No `presence` field: who is online comes from Live Sync's `presence.updated` (§7.2), per project.                                   |
| `UserProfile`                     | No `role`: roles belong to a workspace membership (`/auth/me` → `workspaces[].role`, `/bootstrap` → `workspace.role`).              |
| `UserProfile`                     | Adds `isDemo`: a shared demo account, whose profile, tokens and new workspaces are locked (§8).                                     |
| `UserProfile`                     | Adds `emailVerified`: the owner proved the address (§5.11).                                                                         |
| `UserProfile`, later `TeamMember` | The avatar field is `gradient`, as in `lib/members.ts`, not the brief's `avatarColor`.                                              |
| Every `id` except issues          | UUIDs instead of the fixtures' `u-jr`, `p-dev`, `dev-todo`, `s-p-dev-25`, `pat_01` style ids.                                       |
| `Issue.id`                        | The issue key (`DEV-104`), as in `types.ts`. Keys are never zero-padded: the fixtures' `DEV-088` is `DEV-88` (lookups accept both). |
| `Issue.git`, `Issue.dueAt`        | Omitted when absent, as their `?` in `types.ts` allows; never `null`.                                                               |
| `ProjectSummary` (`/projects`)    | A `Project` plus `activeSprint`, `backlogCount` and `lead`, for the sidebar and Projects overview.                                  |

### 1.2 Workspaces and URLs

A **workspace** is a private team space with its own projects, sprints, issues, members and invites. A user can
belong to many, with a role in each (`admin`, `member` or `viewer`). The profile and access tokens belong to the
account.

```
/api/v2/auth/…, /me, /me/tokens, /invites/{token}, /workspaces, /config     global: the account and the list
/api/v2/workspaces/{slug}                                                   one workspace
/api/v2/workspaces/{slug}/bootstrap, /members, /invites, /projects/…,       everything in it
                          /issues/…, /sprints/…, /demo/reset, /leave
/api/auth/oauth/{provider}/callback, /api/integrations/github/webhook       registered with the providers (§5.5, §7.5)
```

- **Slugs** (`acme-inc`) come from the workspace name when it is created, get a short suffix when taken
  (`acme-inc-x7k2`), and never change when the workspace is renamed, so URLs keep working. Use the slug in the
  frontend's own URLs too.
- **Isolation:** a workspace you are not a member of answers `404 NOT_FOUND` on every route, exactly like one that
  does not exist. There is no separate "not a member" code, so slugs reveal nothing; treat a 404 on the workspace
  itself as "this workspace is gone or you were removed" and send the user to another workspace.
- Project keys and issue keys are unique **per workspace**: two workspaces can both have `DEV-104`.

## 2. Endpoint coverage matrix

**Since** is the release that first offered the feature. Every path moved to `/api/v2` in `2.0.0-beta.2`; paths
starting with `/workspaces/:ws` are relative to `/api/v2`, `:ws` being the workspace slug.

### Board, backlog and project data — `lib/tracker/store.ts`

| Frontend function             | UI action                             | Endpoint                                                                                  | Since |
| ----------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- | ----- |
| `useTracker()` (initial data) | Load the app / a project              | `GET /workspaces/:ws/bootstrap`, `GET /workspaces/:ws/projects/:key/snapshot`             | 0.4.0 |
| `createIssue`                 | Create Issue dialog, quick add        | `POST /workspaces/:ws/projects/:key/issues`                                               | 0.4.0 |
| `updateIssue`                 | Issue sheet field edits               | `PATCH /workspaces/:ws/issues/:issueKey`                                                  | 0.4.0 |
| `moveIssueToStatus`           | Drag card between board columns       | `POST /workspaces/:ws/issues/:issueKey/move`                                              | 0.4.0 |
| `moveIssueToSprint`           | Backlog drag, "Move to" menu, ranking | `POST /workspaces/:ws/issues/:issueKey/move`                                              | 0.4.0 |
| `deleteIssue`                 | Issue sheet → Delete                  | `DELETE /workspaces/:ws/issues/:issueKey`                                                 | 0.4.0 |
| `createSprint`                | Backlog → "+ Sprint"                  | `POST /workspaces/:ws/projects/:key/sprints`                                              | 0.5.0 |
| `updateSprint`                | Edit sprint name & goal               | `PATCH /workspaces/:ws/sprints/:id`                                                       | 0.5.0 |
| `deleteSprint`                | Delete planned sprint                 | `DELETE /workspaces/:ws/sprints/:id`                                                      | 0.5.0 |
| `startSprint`                 | Start sprint dialog                   | `POST /workspaces/:ws/sprints/:id/start`                                                  | 0.5.0 |
| `completeSprint`              | Complete sprint dialog                | `POST /workspaces/:ws/sprints/:id/complete`                                               | 0.5.0 |
| `addStatus`                   | Board "Add column", settings          | `POST /workspaces/:ws/projects/:key/statuses`                                             | 0.4.0 |
| `updateStatus`                | Rename column, change category        | `PATCH /workspaces/:ws/projects/:key/statuses/:id`                                        | 0.4.0 |
| `moveStatus`                  | Move column left/right                | `PUT /workspaces/:ws/projects/:key/statuses/order` (send the full new order)              | 0.4.0 |
| `deleteStatus`                | Delete column                         | `DELETE /workspaces/:ws/projects/:key/statuses/:id?moveTo=`                               | 0.4.0 |
| `createProject`               | New project dialog                    | `POST /workspaces/:ws/projects`                                                           | 0.4.0 |
| `updateProject`               | Project settings → General            | `PATCH /workspaces/:ws/projects/:key`                                                     | 0.4.0 |
| `deleteProject`               | Project settings → Delete             | `DELETE /workspaces/:ws/projects/:key`                                                    | 0.4.0 |
| `resetDemoData`               | Workspace settings → Reset demo data  | `POST /workspaces/:ws/demo/reset` (resets the sample projects, §5.10)                     | 0.4.0 |
| Reports page                  | Burndown, velocity, history           | `GET /workspaces/:ws/sprints/:id/burndown`, `GET /workspaces/:ws/projects/:key/reports/*` | 0.5.0 |
| Issue sheet comments          | Read and add comments                 | `GET`/`POST /workspaces/:ws/issues/:issueKey/comments`                                    | 0.4.0 |
| ⌘K jump                       | Open an issue by key or number        | `GET /workspaces/:ws/issues/:issueKey` (`104` needs `?project=DEV`)                       | 0.4.0 |
| Live Sync, presence avatars   | Teammates' changes appear live        | Socket.IO `/realtime` at `/api/v2/socket.io` (§7)                                         | 0.6.0 |
| Issue card / sheet git badge  | PR or commit linked from GitHub       | `Issue.git`, set by GitHub webhooks (§7.5)                                                | 0.6.0 |

### Account and workspaces

| Frontend component                     | UI action                         | Endpoint                                                                        | Since        |
| -------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------- | ------------ |
| App load                               | Session check, list of workspaces | `GET /auth/me`                                                                  | 0.2.0        |
| `components/auth/auth-form.tsx`        | Sign in / sign up                 | `POST /auth/login`, `POST /auth/signup`                                         | 0.2.0        |
| `auth-form.tsx`                        | Forgot password                   | `POST /auth/password/forgot`                                                    | 0.2.0        |
| `/reset-password` page                 | Choose a new password             | `POST /auth/password/reset`                                                     | 0.2.0        |
| New `/verify-email` page               | Verify the email address          | `POST /auth/email/verify`                                                       | 2.0.0-beta.4 |
| New "verify your email" banner         | Resend the verification email     | `POST /auth/email/resend`                                                       | 2.0.0-beta.4 |
| `auth-form.tsx` OAuth buttons          | Show / hide providers             | `GET /config`                                                                   | 0.1.0        |
| `auth-form.tsx` OAuth buttons          | Continue with GitHub / Google     | `GET /auth/oauth/:provider` (browser navigation)                                | 0.2.0        |
| API client                             | Renew an expired access token     | `POST /auth/refresh`                                                            | 0.2.0        |
| `components/layout/app-sidebar.tsx`    | Log out                           | `POST /auth/logout`                                                             | 0.2.0        |
| `components/profile/profile-view.tsx`  | Load / save personal settings     | `GET /me`, `PATCH /me`                                                          | 0.2.0        |
| `components/profile/access-tokens.tsx` | List / generate / revoke tokens   | `GET /me/tokens`, `POST /me/tokens` (pick a workspace), `DELETE /me/tokens/:id` | 0.2.0        |
| New workspace switcher                 | List and switch workspaces        | `GET /auth/me` (`workspaces`), `GET /workspaces`                                | 2.0.0-beta.2 |
| New "Create workspace" dialog          | Create a workspace                | `POST /workspaces`                                                              | 2.0.0-beta.2 |
| Workspace settings                     | Rename / delete / leave           | `PATCH`/`DELETE /workspaces/:ws`, `POST /workspaces/:ws/leave`                  | 2.0.0-beta.2 |
| Settings header, permissions           | Workspace name and your role      | `GET /workspaces/:ws` (also in `/bootstrap`)                                    | 0.3.0        |
| `components/settings/team-members.tsx` | List members and pending invites  | `GET /workspaces/:ws/members`                                                   | 0.3.0        |
| `team-members.tsx`                     | Invite / resend invite            | `POST /workspaces/:ws/invites`, `POST /workspaces/:ws/invites/:id/resend`       | 0.3.0        |
| `team-members.tsx`                     | Change role                       | `PATCH /workspaces/:ws/members/:id`                                             | 0.3.0        |
| `team-members.tsx`                     | Remove member / revoke invite     | `DELETE /workspaces/:ws/members/:id`                                            | 0.3.0        |
| `/invite` page                         | Preview and accept an invite      | `GET /invites/:token`, `POST /invites/:token/accept`                            | 0.3.0        |
| `/invite` page, signed in              | Join with an existing account     | `POST /invites/:token/join`                                                     | 2.0.0-beta.3 |

### Operational

| Endpoint                                | Purpose                                                | Since |
| --------------------------------------- | ------------------------------------------------------ | ----- |
| `GET /health`                           | Liveness, `{ status: "ok" }`                           | 0.1.0 |
| `GET /health/ready`                     | Readiness: `200` / `503` with per-dependency `checks`  | 0.1.0 |
| `GET /openapi.json`                     | OpenAPI 3.1 document                                   | 0.1.0 |
| `GET /docs`                             | Swagger UI                                             | 0.1.0 |
| `POST /api/integrations/github/webhook` | GitHub App deliveries (called by GitHub, version-free) | 0.6.0 |

## 3. Feature flags — `GET /config`

No authentication; call it before sign-in (it is also part of `GET /workspaces/:ws/bootstrap`). Cached for 5 minutes
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
  "instance": "/api/v2/workspaces/acme-inc/sprints/0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e6f/start",
  "code": "SPRINT_ALREADY_ACTIVE",
  "requestId": "6f1c2a9e-3b7d-4c8e-9f0a-1b2c3d4e5f60"
}
```

- Switch on **`code`**, never on `title` or `detail` (human-readable, may change).
- `422 VALIDATION_FAILED` adds `errors: [{ field, message }]`, one entry per invalid field. `field` is the
  dot-separated path within the body, query or route parameters (e.g. `email`, `scopes.0`); `(root)` means the body
  as a whole (e.g. an empty PATCH). The `message`s are written to be shown next to the field.

### 4.1 Rate limits

Limits are counted per client IP (sign-in failures per IP **and** email), except where the table says otherwise. Past a limit the API answers
`429 RATE_LIMITED` with `Retry-After` (seconds). Every response except `/health` carries a `RateLimit` header with the
remaining quota.

| Applies to                                                                            | Limit             |
| ------------------------------------------------------------------------------------- | ----------------- |
| Every request except `/health`                                                        | 600 a minute      |
| Failed `POST /auth/login` for one email                                               | 10 per 15 minutes |
| `POST /auth/login`, `/auth/signup`, `/auth/password/*`, `/auth/email/*`, OAuth starts | 50 per 15 minutes |
| `POST /auth/signup`                                                                   | 10 an hour        |
| `POST /auth/refresh`                                                                  | 60 per 15 minutes |
| `POST /workspaces`, per user                                                          | 10 a day          |
| `POST /workspaces/:ws/invites`, `.../resend`                                          | 30 an hour        |
| The same, per workspace (whoever sends them)                                          | 50 a day          |
| `GET /invites/:token`, `POST /invites/:token/accept` and `/join`                      | 30 per 15 minutes |

On `429`: show "Too many attempts, try again in N minutes" (from `Retry-After`), keep the form's input, and don't
retry automatically. The refresh flow (§5.3) should treat a `429` from `/auth/refresh` as "try again later", not as
signed out. A Live Sync reconnect storm is not limited (sockets are not counted), but the snapshot re-fetch after it
is.

### Error catalogue

Codes are stable: new ones may be added, existing ones are never renamed or repurposed.

| Code                        | HTTP | Meaning                                                                         | Returned by                                                                                                |
| --------------------------- | ---- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `BAD_REQUEST`               | 400  | The body is not valid JSON                                                      | Any endpoint with a JSON body, the GitHub webhook                                                          |
| `VERIFY_TOKEN_INVALID`      | 400  | The verification link is unknown, already used, replaced or expired             | `POST /auth/email/verify` (new in `beta.4`)                                                                |
| `RESET_TOKEN_INVALID`       | 400  | The reset link is unknown, already used or expired; request a new one           | `POST /auth/password/reset`                                                                                |
| `INVITE_INVALID`            | 400  | The invite link is unknown, used, replaced by a resend or expired               | `GET /invites/:token`, `POST /invites/:token/accept`, `/join`                                              |
| `UNAUTHENTICATED`           | 401  | Not signed in (or the session was revoked); redirect to `/login`                | Every authenticated endpoint, `POST /auth/refresh`                                                         |
| `TOKEN_EXPIRED`             | 401  | Access token expired; call `POST /auth/refresh` once and retry                  | Every cookie-authenticated endpoint                                                                        |
| `INVALID_CREDENTIALS`       | 401  | Wrong email or password (same answer for unknown emails)                        | `POST /auth/login`                                                                                         |
| `WEBHOOK_SIGNATURE_INVALID` | 401  | `X-Hub-Signature-256` missing or wrong (GitHub only, never the frontend)        | `POST /api/integrations/github/webhook`                                                                    |
| `FORBIDDEN`                 | 403  | Not allowed: role too low, cross-site write, or a token on a session-only route | Every write (origin check), admin routes, `PATCH /me`, `/me/tokens`, `/workspaces`                         |
| `CANNOT_CHANGE_OWN_ROLE`    | 403  | Admins cannot change their own role                                             | `PATCH /workspaces/:ws/members/:id`                                                                        |
| `CANNOT_REMOVE_SELF`        | 403  | Admins cannot remove themselves (use leave)                                     | `DELETE /workspaces/:ws/members/:id`                                                                       |
| `DEMO_WORKSPACE_LOCKED`     | 403  | Turned off in the public demo workspace (§5.10)                                 | Rename, delete, leave, invites, member changes in the demo workspace (new in `beta.2`)                     |
| `EMAIL_UNVERIFIED`          | 403  | Verify your email before inviting (only while the server delivers email)        | `POST /workspaces/:ws/invites`, `.../resend` (new in `beta.4`)                                             |
| `INVITE_EMAIL_MISMATCH`     | 403  | Joining while signed in with an account whose email is not the invited one      | `POST /invites/:token/join` (new in `beta.3`)                                                              |
| `DEMO_ACCOUNT_LOCKED`       | 403  | Turned off for the shared demo accounts (§8)                                    | `PATCH /me`, `POST`/`DELETE /me/tokens`, `POST /workspaces`, `POST /invites/:token/join` (new in `beta.2`) |
| `NOT_FOUND`                 | 404  | Unknown route or resource, or a workspace you are not a member of (§1.2)        | Any route, disabled OAuth provider or GitHub App                                                           |
| `EMAIL_TAKEN`               | 409  | The email already has an account (accepting an invite: sign in and join)        | `POST /auth/signup`, `POST /invites/:token/accept`                                                         |
| `PROJECT_KEY_TAKEN`         | 409  | Project key already in use in this workspace                                    | `POST /workspaces/:ws/projects`                                                                            |
| `SPRINT_ALREADY_ACTIVE`     | 409  | Another sprint is active in the project; complete it first                      | `POST /workspaces/:ws/sprints/:id/start`                                                                   |
| `SPRINT_NOT_PLANNED`        | 409  | Only planned sprints can be started or deleted                                  | `POST .../sprints/:id/start`, `DELETE .../sprints/:id`                                                     |
| `SPRINT_NOT_ACTIVE`         | 409  | Only the active sprint can be completed                                         | `POST .../sprints/:id/complete`                                                                            |
| `STATUS_DELETE_BLOCKED`     | 409  | Deleting would leave < 2 statuses or no to-do / done status (`detail` says why) | `DELETE .../projects/:key/statuses/:id`                                                                    |
| `STATUS_UPDATE_BLOCKED`     | 409  | Recategorising would leave no to-do or no done status (`detail` says why)       | `PATCH .../projects/:key/statuses/:id`                                                                     |
| `LAST_ADMIN`                | 409  | The last admin cannot be demoted, removed or leave (`detail` says what to do)   | `PATCH`/`DELETE /workspaces/:ws/members/:id`, `POST /workspaces/:ws/leave`                                 |
| `ALREADY_MEMBER`            | 409  | The email is already a member of this workspace, or already invited to it       | `POST /workspaces/:ws/invites`, `POST /invites/:token/join`                                                |
| `CONFLICT_STALE`            | 412  | `If-Match` no longer matches; re-fetch and retry                                | `PATCH /me`, `PATCH .../projects/:key`, `PATCH .../issues/:issueKey`                                       |
| `PAYLOAD_TOO_LARGE`         | 413  | Body larger than 100 kB                                                         | Any endpoint with a JSON body                                                                              |
| `VALIDATION_FAILED`         | 422  | Invalid fields, listed in `errors`                                              | Every endpoint with input                                                                                  |
| `RATE_LIMITED`              | 429  | Too many requests; wait `Retry-After` seconds (§4.1)                            | Any endpoint except `/health`                                                                              |
| `INTERNAL_ERROR`            | 500  | Unexpected failure; quote `requestId` when reporting                            | Any endpoint                                                                                               |
| `EMAIL_DELIVERY_FAILED`     | 502  | The email could not be sent; the invite is saved, offer Resend                  | `POST /workspaces/:ws/invites`, `.../resend`                                                               |

## 5. Authentication

### 5.1 Session check

Call `GET /auth/me` on app load:

- `200` → `{ user: UserProfile, workspaces: Workspace[] }`. Each workspace is
  `{ id, slug, name, role, isDemo }`, oldest membership first; `role` is your role **in that workspace**.
- `401 UNAUTHENTICATED` → signed out: redirect to `/login`.
- `401 TOKEN_EXPIRED` → refresh (§5.3) and retry once.

`POST /auth/signup` (`201`) and `POST /auth/login` (`200`) return the same body and set the session cookies.
**Every new account gets its own workspace**, "`<name>`'s workspace", as admin, pre-filled with a copy of the sample
projects (§5.10); so right after sign-up `workspaces` has one entry. An account can also end up with **no
workspaces** (it left or was removed from all of them): show a "Create a workspace" screen then. A password sign-up
also emails a verification link (§5.11).

```json
{
  "user": { "id": "0193f1c2-…", "name": "Ada Lovelace", "handle": "ada", "email": "ada@acme.dev", "…": "…" },
  "workspaces": [
    {
      "id": "0193f1c2-…",
      "slug": "ada-lovelaces-workspace",
      "name": "Ada Lovelace's workspace",
      "role": "admin",
      "isDemo": false
    }
  ]
}
```

### 5.2 Cookies

The browser never sees the tokens: both cookies are `HttpOnly; Secure; SameSite=Lax` and are set and cleared by the
API. Nothing to store in `localStorage`; just send `credentials: "include"`.

| Cookie            | Path              | Contains                             | Lifetime                                                                                        |
| ----------------- | ----------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `devflow_access`  | `/api/v2`         | Access JWT, valid for **15 minutes** | Cookie kept for the session, so an expired JWT still reaches the API and yields `TOKEN_EXPIRED` |
| `devflow_refresh` | `/api/v2/auth`    | Rotating refresh token               | The session: **30 days** from sign-in, not extended by use                                      |
| `devflow_oauth`   | `/api/auth/oauth` | OAuth state, during sign-in only     | 10 minutes                                                                                      |

`localhost:3000` and `localhost:4000` are the same site, so the cookies flow between them. Chrome and Firefox accept
`Secure` cookies on `http://localhost`; if your browser does not, use one of those for local development.

The access cookie is deliberately scoped to `/api/v2`, so the frontend's own server never receives it. Everything
that needs the session therefore lives under `/api/v2`, including the realtime endpoint (§7). Sessions from v1 had
cookies scoped to `/api/v1`, so everyone signs in again once.

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
http://localhost:4000/api/v2/auth/oauth/github?redirect=/projects
```

- `redirect` must be a relative path on the frontend (default `/projects`); anything else falls back to `/projects`.
- Success → redirect to `${CORS_ORIGIN}${redirect}`, signed in. Call `GET /auth/me` to pick the workspace.
- Failure → redirect to `${CORS_ORIGIN}/login?error=<code>`:

| `error`                  | Meaning                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `oauth_denied`           | The user cancelled on the provider's consent screen                           |
| `oauth_state_mismatch`   | The sign-in link expired (10 min) or was tampered with: start again           |
| `oauth_email_unverified` | The provider account has no verified email, so it cannot be linked or created |
| `oauth_account_locked`   | The email belongs to a shared demo account, which cannot be linked (new)      |
| `oauth_failed`           | The provider could not be reached or rejected the request: try again          |

Accounts are matched by provider identity first, then by verified email, otherwise a new account is created, with
its own workspace like a sign-up. Sign-up does not verify email addresses, so when a provider claims an existing
**password** account, the provider is linked and the account is secured: its password is removed and its other
sessions and access tokens are revoked. The owner signs in with the provider from then on, or sets a password again
through "Forgot password".

The provider redirects to `${API_URL}/api/auth/oauth/{github,google}/callback`. That URL is outside `/api/v2` on
purpose: it is registered with GitHub and Google, and stays the same in future API versions.

### 5.6 Password reset

`POST /auth/password/forgot { email }` always answers `202`, whether or not the account exists. The email links to:

```
${CORS_ORIGIN}/reset-password?token=<token>
```

The `/reset-password` page reads `token` and calls `POST /auth/password/reset { token, password }`:
`204` → show "Password changed, sign in"; `400 RESET_TOKEN_INVALID` → offer to request a new link. Links work once,
expire after 60 minutes, and only the newest one works. Passwords are 8–128 characters. A reset also revokes every
session and **deletes the account's personal access tokens**: say so on the success screen ("Create new access
tokens for scripts and the CLI"). The shared demo accounts never get a reset link (§8).

### 5.7 Invites

Admins invite with `POST /workspaces/:ws/invites { email, role }` (`201` → the pending `TeamMember`). The email links
to:

```
${CORS_ORIGIN}/invite?token=<token>
```

Anyone who is not yet a member of the workspace can be invited, whether or not they already use DevFlow. The
`/invite` page reads `token` and shows `GET /invites/:token`:

```json
{
  "email": "grace@acme.dev",
  "role": "member",
  "workspace": { "name": "Acme Inc", "slug": "acme-inc" },
  "invitedBy": { "name": "John Rey" },
  "expiresAt": "2026-11-09T09:00:00.000Z",
  "accountExists": false
}
```

`accountExists` decides the rest of the page:

- **`false`, a new person:** a name and password form submitting `POST /invites/:token/accept { name, password }`.
  `201` → the account exists, is a member of **that workspace only** with the invited role (no workspace of its own),
  is signed in (same body and cookies as `/auth/signup`) and its email counts as verified. Continue into the
  workspace. `409 EMAIL_TAKEN` means the email signed up in the meantime: switch to joining.
- **`true`, an existing account:** ask them to sign in with that email (keep the token, e.g. `/login?redirect=/invite?token=…`),
  then `POST /invites/:token/join` (no body) with the session. `200` → the `Workspace` they joined, with their role;
  it now appears in `/auth/me` next to their other workspaces, and their email counts as verified. Signed in with
  another account → `403 INVITE_EMAIL_MISMATCH` (the invite stays usable: offer to sign out and in again). Already a
  member → `409 ALREADY_MEMBER`. Demo accounts → `403 DEMO_ACCOUNT_LOCKED`. Access tokens → `403 FORBIDDEN`.

All three answer `400 INVITE_INVALID` for a link that is unknown, already used, replaced by a resend or older than 7
days. An invite works once, whichever way it is used.

`POST /workspaces/:ws/invites/:id/resend` emails a fresh link; the previous link stops working. Inviting an email that
is already a member of this workspace or already invited to it answers `409 ALREADY_MEMBER`. If the email cannot be
sent, the API answers `502 EMAIL_DELIVERY_FAILED` but keeps the invite, so show the error and offer Resend instead of
"Invite sent". While the server delivers email (`GET /config` → `email: true`), only accounts with a verified email
can invite: others get `403 EMAIL_UNVERIFIED` (§5.11).

### 5.8 Personal access tokens

`POST /me/tokens { name, scopes, expiresInDays, workspace }` returns `{ token, secret }`. `workspace` is the slug of
the **one workspace the token works in**; you must be a member (`422` on `workspace` otherwise), so the dialog needs
a workspace picker (default: the current one). **The secret is shown once**; afterwards only `lastFour` is available.
Every token in `GET /me/tokens` carries `workspace: { id, slug, name }`.

Clients use it as `Authorization: Bearer dfp_…`. On any other workspace's routes the token gets `404`, and it stops
working there once its owner leaves or is removed (their tokens for that workspace are deleted). A token can read
`GET /auth/me` and `GET /me` but cannot change the profile, manage tokens or list and create workspaces
(`403 FORBIDDEN`). Scopes gate what else it may do; signed-in sessions are not scoped:

| Scope             | Allows                                                                               |
| ----------------- | ------------------------------------------------------------------------------------ |
| `issues:read`     | Read projects, issues, comments, snapshots, `/bootstrap`, the workspace and members  |
| `issues:write`    | Create, update, move and delete issues; comment                                      |
| `projects:admin`  | Create, update and delete projects; edit workflows (the caller's role still applies) |
| `webhooks:manage` | Reserved; GitHub deliveries authenticate with their signature, not a token           |

### 5.9 Roles and permissions

Roles are **per workspace**: `GET /auth/me` lists your role in each workspace, and `GET /workspaces/:ws` and
`/bootstrap` return your role in the current one. Hide or disable what the role cannot do; the API enforces it anyway
with `403 FORBIDDEN`.

| Action                                                          | viewer | member | admin |
| --------------------------------------------------------------- | ------ | ------ | ----- |
| Create a workspace of your own (you become its admin)           | ✓      | ✓      | ✓     |
| Read the workspace, members and invites                         | ✓      | ✓      | ✓     |
| Read projects, issues, comments                                 | ✓      | ✓      | ✓     |
| Leave the workspace                                             | ✓      | ✓      | ✓\*   |
| Create and edit issues and comments; create and rename projects |        | ✓      | ✓     |
| Create, edit, start, complete and delete sprints                |        | ✓      | ✓     |
| Invite, change roles, remove members, revoke invites            |        |        | ✓     |
| Edit the workflow, delete projects, reset the sample data       |        |        | ✓     |
| Rename or delete the workspace                                  |        |        | ✓     |

\* Not the last admin (`409 LAST_ADMIN`).

- Roles are read from the database on every request: a demotion applies to the member's very next request.
- Workspace and member management also need a signed-in session: access tokens get `403` even for an admin.
- Admins cannot change their own role (`CANNOT_CHANGE_OWN_ROLE`) or remove themselves (`CANNOT_REMOVE_SELF`, use
  leave), and the last admin cannot be demoted, removed or leave (`LAST_ADMIN`), matching the frontend's existing
  locks.
- Removing a member ends their membership immediately: they lose access to the workspace, their access tokens for it
  are deleted and their issues and project leads there are unassigned. Their account and other workspaces stay.
  There is no undo: confirm first. Revoking an invite can be undone by inviting again.
- Role changes are last-write-wins (no `If-Match` on members).
- In the demo workspace some admin actions are locked (§5.10).

### 5.10 Workspaces

| Request                                  | Who                 | Result                                                                                           |
| ---------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /workspaces`                        | Signed-in session   | `{ items: Workspace[], nextCursor }`, oldest membership first (`/auth/me` has the same, unpaged) |
| `POST /workspaces { name, sampleData? }` | Signed-in session   | `201` → the new `Workspace`; you are its admin                                                   |
| `GET /workspaces/:ws`                    | Any member          | The `Workspace` with your role                                                                   |
| `PATCH /workspaces/:ws { name }`         | Admin, session      | The renamed `Workspace`; the slug stays                                                          |
| `DELETE /workspaces/:ws`                 | Admin, session      | `204`; its projects, invites, tokens and memberships are gone, accounts stay. No undo            |
| `POST /workspaces/:ws/leave`             | Any member, session | `204`; as for a removal. The last admin gets `409 LAST_ADMIN` (promote someone, or delete it)    |
| `POST /workspaces/:ws/demo/reset`        | Admin, session      | `204`; restores the sample projects (below)                                                      |

`Workspace` is `{ id, slug, name, role, isDemo }`. Names are 1–48 characters.

**Sample data.** New workspaces (`sampleData` defaults to `true`, and sign-up always uses it) start with a copy of the
sample projects **DEV**, **BIL** and **MOB**, dated relative to now: the issues the demo admin works on in the demo
are yours, everything else is unassigned, you lead every project, and there are no comments. Reset
(`/demo/reset`) replaces those sample projects with fresh copies and **keeps the projects you created**; a sample
whose key one of your projects now uses is skipped. Re-fetch `/bootstrap` afterwards.

**The demo workspace** (`isDemo: true`, the seeded Acme Inc) is shared by every visitor of a public deployment, so
renaming, deleting, leaving it, invites and member changes answer `403 DEMO_WORKSPACE_LOCKED`. Issues, sprints,
workflows, projects and the reset stay open; reset there replaces every project with the demo team's data. Hide the
locked actions when `isDemo` is true and suggest "Create your own workspace".

**Switching.** The API has no "current workspace": every request names one in its path. Keep the slug in the
frontend's URL (e.g. `/w/{slug}/projects`) so links are shareable, and remember the last one used for redirects such
as the OAuth landing page `/projects`.

### 5.11 Email verification

Sign-up does not prove that the address belongs to whoever signed up, so a password sign-up emails a link to:

```
${CORS_ORIGIN}/verify-email?token=<token>
```

The new `/verify-email` page reads `token` and calls `POST /auth/email/verify { token }` (no session needed):
`204` → "Email verified"; `400 VERIFY_TOKEN_INVALID` → the link is unknown, used, replaced by a newer one or older
than 48 hours: offer to send a new one. `POST /auth/email/resend` (signed-in session, no body) always answers `202`
and emails a fresh link unless the address is already verified; earlier links stop working.

`UserProfile.emailVerified` says where the account stands. OAuth accounts, accounts created or joined through an
invite, and accounts that reset their password are verified by those steps. Unverified accounts can do everything in
their own workspaces except **send invites**, which answer `403 EMAIL_UNVERIFIED`. That rule only applies while the
server delivers email (`GET /config` → `email: true`): with `email: false` the links only reach the server log, so
nobody is asked to verify. Show a "Verify your email" banner with a Resend button when `emailVerified` is `false` and
`config.email` is `true`.

## 6. Projects, workflow and issues

Every path in this section is under `/api/v2/workspaces/{slug}`.

### 6.1 Loading

Call `GET /workspaces/:ws/bootstrap` once after choosing a workspace (`{ me, workspace, config, projects }`, with each
project's summary; `workspace` is `{ id, slug, name, role, isDemo }`), then `GET /workspaces/:ws/projects/:key/snapshot`
per project: `{ project, sprints, issues }` where `project.workflow` is in board order, `sprints` are all sprints by
number (completed ones carry `report`), and `issues` are the backlog and planned/active sprints in **rank order**, the
array order the store already uses. Neither is paginated; `GET .../projects/:key/issues` offers filtered, paginated
access (`sprint=<id>|backlog|active`, `assignee=<id>|none`, `priority`, `type`, `q`, `mine=true`). Switching
workspaces means a new bootstrap; nothing carries over.

### 6.2 Issues

- Keys come from a per-project counter (`DEV-134`, never reused). `GET .../issues/:issueKey` accepts any case and
  `DEV-088`-style padding; a bare `104` needs `?project=DEV`. All issue endpoints take the key, never the UUID.
- `POST .../projects/:key/issues` puts the issue at the top of the ranking, like `createIssue`. Omitted fields default
  to `type: task`, `priority: medium`, no assignee, estimate or sprint, and the first to-do status. The assignee must
  be a member of the workspace.
- `resolvedAt` is managed by the API: set when an issue enters a done-category status, cleared when it leaves. Don't
  send it. `tags`, `dueAt` and `git` are read-only, as in the store (`git` is set by GitHub, §7.5).
- `PATCH .../issues/:issueKey` and `PATCH .../projects/:key` return an `ETag`; send `If-Match` to get `412` instead of
  overwriting a teammate's change.

### 6.3 Moving and ranking

`POST .../issues/:issueKey/move { statusId?, sprintId?, beforeIssueKey? }` replaces `moveIssueToStatus` and
`moveIssueToSprint` and returns the moved issue:

| Request                              | Result (as the store does today)         |
| ------------------------------------ | ---------------------------------------- |
| `{ statusId }`                       | New column; the issue floats to the top  |
| `{ sprintId }` (or `null` = backlog) | New container; the issue goes to the end |
| `{ …, beforeIssueKey: "DEV-121" }`   | Placed directly before DEV-121           |

Only the moved issue changes; other issues keep their positions. Re-fetching the snapshot gives the new order.

### 6.4 Workflow

Admins edit columns with `POST .../projects/:key/statuses` (inserted before the first done status, unless it is
done), `PATCH …/:id`, `PUT …/order { statusIds }` (the store's `moveStatus` swaps neighbours: send the resulting full
order) and `DELETE …/:id?moveTo=<statusId>` (`moveTo` is required when the column has issues). Each answers with the
whole `Project`, so replace the cached workflow with `project.workflow`. Guards match `cannotDeleteStatusReason`.

### 6.5 Sprints

Members and admins run the lifecycle; every call answers with the frontend's `Sprint`:

| Store function   | Endpoint                                                  | Rules                                                                               |
| ---------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `createSprint`   | `POST .../projects/:key/sprints` (no body)                | Creates `Sprint {n+1}`, planned                                                     |
| `updateSprint`   | `PATCH .../sprints/:id { name?, goal? }`                  | Any status                                                                          |
| `deleteSprint`   | `DELETE .../sprints/:id`                                  | Planned only (`SPRINT_NOT_PLANNED`); its issues return to the backlog               |
| `startSprint`    | `POST .../sprints/:id/start { name, goal, durationDays }` | Planned only; one active sprint per project (`SPRINT_ALREADY_ACTIVE`); 1 to 28 days |
| `completeSprint` | `POST .../sprints/:id/complete { carryOver }`             | Active only (`SPRINT_NOT_ACTIVE`); `carryOver` is the store's `CarryOver`           |

Starting snapshots `committedPoints`. Completing writes `report`, sets `completedAt` and moves every issue not in a
done status to the backlog, a planned sprint (`{ kind: "sprint", sprintId }`) or a sprint it creates
(`{ kind: "new-sprint" }`), all in one transaction. The response is `{ sprint, carriedOverTo }`: `carriedOverTo` is the
sprint that received the issues (the new one for `new-sprint`), or `null` for the backlog. Re-fetch the snapshot
afterwards to pick up the moved issues. `GET .../projects/:key/sprints?status=planned,active` lists sprints by number.

### 6.6 Reports

| Report   | Endpoint                                         | Shape                                                               |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| Burndown | `GET .../sprints/:id/burndown`                   | `{ sprintId, committedPoints, days: [{ date, ideal, remaining }] }` |
| Velocity | `GET .../projects/:key/reports/velocity?limit=8` | `[{ sprintId, name, committed, completed }]`, oldest first          |
| History  | `GET .../projects/:key/reports/history`          | `{ items: Sprint[], nextCursor }`, completed sprints newest first   |

`days` has one point per sprint day, exactly the `BurndownDay[]` the reports view builds today, so it can be passed
to `BurndownChart` as is. The difference is where `remaining` comes from: the issue history rather than today's
`resolvedAt` values, so issues added, removed, re-estimated or reopened mid-sprint are counted correctly. `ideal`
starts from `committedPoints`; `remaining` is `null` for days still ahead. A planned sprint has no days.

## 7. Realtime (Live Sync) and GitHub

### 7.1 Connecting

Socket.IO 4, namespace **`/realtime`**, mounted at **`/api/v2/socket.io`** (not the default `/socket.io`) so the
handshake carries the `/api/v2`-scoped session cookie:

```ts
import { io } from "socket.io-client";

const socket = io("http://localhost:4000/realtime", { path: "/api/v2/socket.io", withCredentials: true });
// Scripts and the CLI: io(url, { path, auth: { token: "dfp_…" } }) — joining needs the issues:read scope.
```

- The handshake is authenticated once, with the session cookie or a personal access token, and must come from
  `CORS_ORIGIN` (other origins are refused). One connection serves every workspace.
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

Events are sent per project. Join the projects the user is looking at (or every project from `/bootstrap`), naming
the workspace:

```ts
socket.emit("project:join", { workspace: "acme-inc", projectKey: "DEV" }, (res) => {
  // { ok: true, workspace: "acme-inc", projectKey: "DEV" }
  // or { ok: false, code: "NOT_FOUND" | "FORBIDDEN" | "VALIDATION_FAILED", message }
});
socket.emit("project:leave", { workspace: "acme-inc", projectKey: "DEV" });
```

Membership is checked on join, as on the REST routes: a workspace you are not a member of answers `NOT_FOUND`. A
bare key (`"DEV"`, the v1 payload) answers `VALIDATION_FAILED`. When switching workspaces, leave the old workspace's
rooms.

Rooms are not remembered across reconnects: **re-join on every `connect`**, then re-fetch
`GET /workspaces/:ws/projects/:key/snapshot`, because events sent while disconnected are not replayed.

`presence.updated` is sent to the room whenever someone joins, leaves or disconnects. `online` lists the user ids
(`TeamMember.id`) with at least one tab in the room, the joining user included:

```json
{ "workspaceId": "0193f1c2-…", "projectKey": "DEV", "actorId": "0193f1c2-…", "online": ["0193f1c2-…", "0193f1c2-…"] }
```

### 7.3 Events

Every payload has `workspaceId` (the `Workspace.id`, so a client with several workspaces open can route it),
`projectKey` and `actorId`: the user who made the change, or `null` for the system (GitHub). The user who made a
change receives its event too: **ignore events whose `actorId` is your own user id**, since the HTTP response already
updated the store. Resources inside payloads have exactly the REST shapes (`Issue`, `Sprint`, `Project`).

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
  "workspaceId": "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e00",
  "projectKey": "DEV",
  "actorId": "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e11",
  "issue": { "id": "DEV-134", "statusId": "0193f1c2-…", "sprintId": "0193f1c2-…", "title": "Live!", "…": "…" },
  "beforeIssueKey": "DEV-104"
}

// issue.deleted
{ "workspaceId": "0193f1c2-…", "projectKey": "DEV", "actorId": "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e11", "issueKey": "DEV-134" }

// sprint.completed with carry-over into a new sprint
{
  "workspaceId": "0193f1c2-…",
  "projectKey": "DEV",
  "actorId": "0193f1c2-8a4b-7c3d-9e5f-1a2b3c4d5e11",
  "sprint": { "id": "0193f1c2-…", "name": "Sprint 25", "status": "completed", "report": { "…": "…" } },
  "carriedOverTo": { "id": "0193f1c2-…", "name": "Sprint 27", "status": "planned" },
  "issues": [{ "id": "DEV-118", "sprintId": "0193f1c2-…", "…": "…" }]
}
```

### 7.4 Applying events safely

- Drop events for workspaces or projects that are not in the store.
- Each event is sent as soon as its change commits. Two changes made at the same moment may arrive in either order,
  and two people editing the same field is still last-write-wins; send `If-Match` (§1) where it matters.
- The snapshot is always authoritative. When in doubt (a reconnect, an event about an issue or sprint the store
  doesn't have), re-fetch it.

### 7.5 GitHub integration

When `GET /config` reports `githubIntegration: true`, GitHub App webhooks
(`POST /api/integrations/github/webhook`, called by GitHub, never by the frontend; version-free like the OAuth
callback) keep `Issue.git` up to date:

- Issue keys are read from pull request titles, branch names (`dev-104-token-refresh`) and commit messages.
- A pull request sets `git: { kind: "pr", number, state }` with `state` `open`, `draft` or `merged`. A merged one also
  moves the issue to the project's first done status (`resolvedAt` set, counted in the burndown). One closed without
  merging removes its own link.
- A commit sets `git: { kind: "commit", sha }` (7 characters), but never replaces a pull request link.
- Each change arrives as `issue.updated`, or `issue.moved` when the status changed, with `actorId: null`. Show it
  as a GitHub change (e.g. "via GitHub").
- **In `beta.2` every delivery applies to the demo workspace only.** `beta.5` links a GitHub App installation to a
  workspace and matches issue keys within it.

## 8. Demo data and accounts

When `SEED_DEMO_DATA=true`, an empty database is seeded with the demo workspace **Acme Inc** (slug `acme-inc`,
`isDemo: true`) and the frontend's team (`lib/account-data.ts`). Every demo account uses the password
**`devflow-demo`**:

| Role in Acme Inc | Email                  | Person       |
| ---------------- | ---------------------- | ------------ |
| admin            | `demo@devflow.local`   | John Rey     |
| member           | `member@devflow.local` | Dmitri Kovac |
| viewer           | `viewer@devflow.local` | Lucas Brandt |

Aiko Mori (`aiko@acme.dev`, admin) and Priya Shah (`priya@acme.dev`, member) exist too. The admin owns the
frontend's two example access tokens; their secrets were never issued, so they cannot authenticate. Demo accounts
have no workspace of their own.

Because their password is public, the five demo accounts are **locked**: no profile edits, no creating or revoking
access tokens, no creating workspaces (`403 DEMO_ACCOUNT_LOCKED`), no password reset links, and OAuth never takes
them over (`oauth_account_locked`). `UserProfile.isDemo` is `true` for them: show those screens read-only and
suggest signing up.

The tracker is the frontend's demo (`lib/tracker/seed.ts`): projects **DEV**, **BIL** and **MOB** with the same
workflows, sprints, issues and states, dated relative to the moment the database was seeded, and as many short demo
comments per issue as the frontend shows. `POST /workspaces/acme-inc/demo/reset` (admins) restores it at any time
without touching accounts; a public deployment also restores the whole demo workspace nightly (`npm run demo:reset`,
see the API's `docs/DEPLOYMENT.md`).

## 9. Known limitations

- OAuth sign-in still reclaims accounts registered with someone else's unverified address (§5.5).
- `beta.2`: GitHub deliveries apply to the demo workspace only (§7.5).
- Deleting an issue also deletes its history, so it disappears from past burndowns.
- Live Sync checks membership when a socket joins a room: a member who is demoted or removed keeps receiving that
  project's events until their socket disconnects (their next request is refused as usual).
- Live Sync events are not replayed after a disconnect; re-fetch the snapshot after reconnecting (§7.2).
- GitHub is one-way: DevFlow receives webhooks but does not call GitHub's API, so pull requests opened before the App
  was installed are not linked until their next event.
- Rate limits are per client IP: users behind one corporate NAT share them (the overall limit is generous for that).
- `GET .../projects/:key/snapshot` returns every open issue unpaginated, as the store expects. Large projects make it
  slow; use `GET .../projects/:key/issues` for paged access.
- Signing up directly with an invited email leaves the invite pending; the new account can still join with it.
- `lastActiveAt` is updated on sign-in and on each refresh (about every 15 minutes of activity), not on every request.
