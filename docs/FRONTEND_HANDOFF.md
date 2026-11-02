# Frontend Handoff — What the API Must Deliver

> **For:** the backend developer (human or AI agent) of `dev-flow-be`.
> **Read with:** [`BRIEF.md`](BRIEF.md) (what to build). This document defines what you hand back so the frontend
> ([`dev-flow`](https://github.com/JohnReySeguma/dev-flow)) can integrate **without reading your source code**.

---

## 1. Scope

**In scope — the DevFlow app:** authentication, profile and access tokens, workspace members, projects, workflow
statuses, issues, backlog and sprints, reports, realtime Live Sync and the GitHub integration.

**Out of scope — the public website.** The landing page, legal pages, status page and 404 are static frontend pages.
There is **no CMS**, no content API, no `/status` endpoint and no `/contact` endpoint (the contact form keeps using
FormSubmit). Do not build them.

---

## 2. Deliverables in this repo

Keep these files current. Each release tag must contain them, accurate for that release.

| File | Purpose |
| --- | --- |
| `docs/openapi.json` | Generated OpenAPI 3.1 spec — every endpoint, request/response schema and error response, **with examples**. The frontend generates its TypeScript types from this file. Also served at `/api/v1/docs`. |
| `docs/INTEGRATION.md` | The living integration guide: everything in §3–§8 below, filled in with real values. |
| `CHANGELOG.md` | Per release: endpoints added / changed / removed, under a **Frontend impact** heading. Breaking changes marked **BREAKING**. |
| `README.md` | How to run locally and with Docker, and the demo login (§7). |

Rules for `docs/openapi.json`:
- Regenerate it in the same commit that changes an endpoint — CI fails if it is stale.
- Field names and enum values must match the frontend's [`lib/tracker/types.ts`](https://github.com/JohnReySeguma/dev-flow/blob/main/lib/tracker/types.ts) exactly. If you must differ, say so in `INTEGRATION.md`.
- Every schema has an example taken from the seed data (e.g. issue `DEV-104`).

---

## 3. Endpoint coverage matrix

The frontend currently runs on a local store. Each function below is what a UI action calls today; you map it to an
endpoint. Keep this table in `docs/INTEGRATION.md`, updating the **Endpoint** and **Since** columns as you ship.

### Board, backlog and project data — [`lib/tracker/store.ts`](https://github.com/JohnReySeguma/dev-flow/blob/main/lib/tracker/store.ts)

| Frontend function | UI action | Endpoint | Since |
| --- | --- | --- | --- |
| `useTracker()` (initial data) | Load the app / a project | `GET /bootstrap`, `GET /projects/:key/snapshot` (§4) | |
| `createIssue` | Create Issue dialog, quick add | `POST /projects/:key/issues` | |
| `updateIssue` | Issue sheet field edits | `PATCH /issues/:issueKey` | |
| `moveIssueToStatus` | Drag card between board columns | `POST /issues/:issueKey/move` | |
| `moveIssueToSprint` | Backlog drag, "Move to" menu, ranking | `POST /issues/:issueKey/move` | |
| `deleteIssue` | Issue sheet → Delete | `DELETE /issues/:issueKey` | |
| `createSprint` | Backlog → "+ Sprint" | `POST /projects/:key/sprints` | |
| `updateSprint` | Edit sprint name & goal | `PATCH /sprints/:id` | |
| `deleteSprint` | Delete planned sprint | `DELETE /sprints/:id` | |
| `startSprint` | Start sprint dialog | `POST /sprints/:id/start` | |
| `completeSprint` | Complete sprint dialog | `POST /sprints/:id/complete` | |
| `addStatus` | Board "Add column", settings | `POST /projects/:key/statuses` | |
| `updateStatus` | Rename column, change category | `PATCH /projects/:key/statuses/:id` | |
| `moveStatus` | Move column left/right | `PUT /projects/:key/statuses/order` | |
| `deleteStatus` | Delete column | `DELETE /projects/:key/statuses/:id?moveTo=` | |
| `createProject` | New project dialog | `POST /projects` | |
| `updateProject` | Project settings → General | `PATCH /projects/:key` | |
| `deleteProject` | Project settings → Delete | `DELETE /projects/:key` | |
| `resetDemoData` | Workspace settings → Reset demo data | `POST /workspace/demo/reset` | |
| Reports page | Burndown, velocity, history | `GET /sprints/:id/burndown`, `GET /projects/:key/reports/*` | |

### Account and workspace

| Frontend component | UI action | Endpoint | Since |
| --- | --- | --- | --- |
| `components/auth/auth-form.tsx` | Sign in / sign up / forgot password | `/auth/login`, `/auth/signup`, `/auth/password/forgot` | |
| `auth-form.tsx` OAuth buttons | Continue with GitHub / Google | `GET /auth/oauth/:provider` | |
| `components/layout/app-sidebar.tsx` | Log out | `POST /auth/logout` | |
| `components/profile/profile-view.tsx` | Save personal settings | `PATCH /me` | |
| `components/profile/access-tokens.tsx` | Generate / revoke token | `POST /me/tokens`, `DELETE /me/tokens/:id` | |
| `components/settings/team-members.tsx` | Invite, resend, change role, remove | `/workspace/invites…`, `/workspace/members/:id` | |

---

## 4. Bootstrap endpoints (required by the frontend)

The UI renders a whole project at once. Avoid forcing a dozen requests per page:

- **`GET /api/v1/bootstrap`** → `{ me, workspace, config, projects }` — `projects` are the summaries used by the
  sidebar and the Projects overview (active sprint progress, backlog count, lead). Called once after sign-in.
- **`GET /api/v1/projects/:key/snapshot`** → `{ project, sprints, issues }` where `project` includes its ordered
  `workflow`, `sprints` are all sprints of the project (completed ones with their `report`), and `issues` are every
  issue in the backlog and in planned or active sprints, **ordered by rank**. Completed sprints' issues are excluded.

Both responses must use exactly the shapes of `Project`, `Sprint` and `Issue` in `lib/tracker/types.ts`.

---

## 5. Authentication contract

Document these concretely in `INTEGRATION.md`:

| Topic | What to specify |
| --- | --- |
| Session check | `GET /auth/me` → `200` with the user, or `401` when signed out. The frontend redirects to `/login` on `401`. |
| Cookies | Names, lifetimes, `HttpOnly; Secure; SameSite=Lax; Path=/`. The frontend sends `credentials: "include"` on every request. |
| Expiry & refresh | Expired access token → `401` with `code: "TOKEN_EXPIRED"`; the frontend calls `POST /auth/refresh` once and retries. Any other `401` means signed out. |
| CSRF | Exactly which header or check write requests need (e.g. `Origin` validation only, or an `X-CSRF-Token` header and where to get it). |
| OAuth | Frontend navigates the browser to `/api/v1/auth/oauth/:provider?redirect=/projects`. Success redirects to `${CORS_ORIGIN}<redirect>`; failure to `${CORS_ORIGIN}/login?error=<code>` with the list of possible codes. |
| Password reset | The URL format of the emailed link (the frontend will add a `/reset-password?token=` page). |
| Invites | The URL format of the invite link (the frontend will add an `/invite?token=` page). |
| Feature flags | `GET /config` (also inside `/bootstrap`) → `{ oauth: { github, google }, githubIntegration, email }` so the UI hides disabled options. |

---

## 6. Errors and realtime

**Error catalogue.** List every `code` the API can return, with HTTP status, meaning and the endpoints that use it.
The frontend shows a specific message per code, so codes must be stable. Minimum set:

`VALIDATION_FAILED`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT_STALE` (412),
`EMAIL_TAKEN`, `INVALID_CREDENTIALS`, `PROJECT_KEY_TAKEN`, `SPRINT_ALREADY_ACTIVE`, `SPRINT_NOT_PLANNED`,
`STATUS_DELETE_BLOCKED`, `LAST_ADMIN`, `CANNOT_CHANGE_OWN_ROLE`, `ALREADY_MEMBER`, `RATE_LIMITED`.

**Realtime contract (Socket.IO).** Specify the connection URL and namespace, how authentication works, the join
event, and for every server event: its name, payload schema and an example. Each payload must include
`projectKey`, `actorId` (so the client can ignore echoes of its own changes) and the full updated resource(s).
State the reconnection behaviour: after reconnecting, the frontend re-fetches `/projects/:key/snapshot`.

---

## 7. Demo data and test accounts

- The seed must recreate the frontend's demo workspace — projects **DEV**, **BIL** and **MOB** with the same issue keys,
  workflows, sprints and states as [`lib/tracker/seed.ts`](https://github.com/JohnReySeguma/dev-flow/blob/main/lib/tracker/seed.ts), dated relative to today.
- Provide sign-in accounts for each role and list them in the README:

  | Role | Email | Password |
  | --- | --- | --- |
  | admin | `demo@devflow.local` | documented in README |
  | member | `member@devflow.local` | documented in README |
  | viewer | `viewer@devflow.local` | documented in README |

  These are seed-only demo credentials, created only when `SEED_DEMO_DATA=true`.

---

## 8. Per-release handoff checklist

Include this checklist, completed, in the GitHub release notes or the `CHANGELOG.md` entry of every tag:

- [ ] `docs/openapi.json` regenerated and valid
- [ ] `docs/INTEGRATION.md` coverage matrix updated (§3)
- [ ] New error codes added to the catalogue (§6)
- [ ] New realtime events documented with examples (§6)
- [ ] **Frontend impact** section in `CHANGELOG.md`: what the frontend can now connect, what changed, anything **BREAKING**
- [ ] Seed and demo accounts still work on a fresh database
- [ ] `docker compose up --build` instructions in the README still accurate
- [ ] Known limitations or stubs listed (e.g. "GitHub webhooks parse PRs only, not pushes yet")
