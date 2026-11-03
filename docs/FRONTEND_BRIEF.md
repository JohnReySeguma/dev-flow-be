# DevFlow Frontend — API Integration Brief

> **For:** the frontend developer (human or AI agent) of [`dev-flow`](https://github.com/JohnReySeguma/dev-flow).
> **API repo:** [`dev-flow-be`](https://github.com/JohnReySeguma/dev-flow-be), checked out next to the frontend at
> `../DevFlow-be`. Treat it as **read-only**.
> **Read with:** [`INTEGRATION.md`](INTEGRATION.md) (the contract: conventions, endpoints, error catalogue) and
> [`openapi.json`](openapi.json) (the machine-readable contract).

---

## 1. Your task

Replace the frontend's in-browser demo store with the DevFlow API, **one backend release at a time**. The UI should
not change: same screens, same flows. What changes is where data comes from, plus the loading, error and
permission states that a real server introduces.

The API ships in milestones (§5). Each time a backend release lands, integrate exactly what it adds, release the
frontend, and stop. Steps 1–9 are done (frontend `v1.1.0`–`v1.9.0`; Steps 1–3 on API v1, the rest on API v2,
which makes DevFlow multi-workspace under `/api/v2/workspaces/{slug}`). API `v2.0.0` is the stable contract: only
Step 10 remains.

## 2. Ground rules

- **The contract is `openapi.json` + `INTEGRATION.md`.** Never read the API's source code to learn behaviour, and
  never change anything in `../DevFlow-be`. If the API behaves differently from the contract, report it instead of
  working around it.
- **Keep the demo mode.** When `NEXT_PUBLIC_API_URL` is not set, the app keeps running on today's
  `lib/tracker/store.ts` and `localStorage`, so the public deployment and the live landing-page preview keep working.
  When it is set, the app talks to the API.
- **Match the frontend's history.** Conventional Commits, one `feat/*` branch per integration step, `--no-ff` merges,
  `chore(release): vX.Y.Z` with a `CHANGELOG.md` entry and an annotated tag. Each integration step is a **minor**
  frontend release (the first one is `v1.1.0`).
- **This is not the Next.js you know.** Read the frontend's `AGENTS.md` and the relevant guides in
  `node_modules/next/dist/docs/` before writing Next.js code.
- **Ask when something is ambiguous** or conflicts with what you find.

## 3. Running the API locally

You need Docker Desktop. From `../DevFlow-be`:

```bash
cp .env.example .env     # first time only; set JWT_SECRET (see the API README)
docker compose up -d --build
curl http://localhost:4000/api/v2/health/ready   # {"status":"ok",...}
```

- Base URL: `http://localhost:4000/api/v2`. Swagger UI: `http://localhost:4000/api/v2/docs`.
- The API only accepts browser requests from `http://localhost:3000` (its `CORS_ORIGIN`). Run `next dev` on port 3000.
- Pass `--build` only when the API code has changed (e.g. after pulling a new API release); otherwise
  `docker compose up -d` is enough. `docker compose stop` stops it, and the data survives.

## 4. Architecture to build

### 4.1 Configuration

- `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v2` in `.env.local` (it was `/api/v1` before Step 4). Commit a `.env.example` documenting it. The
  frontend's `.gitignore` ignores `.env*`, so add `!.env.example`.
- One helper (for example `lib/api/config.ts`) answers "is API mode on?". Nothing else reads the variable.

### 4.2 Generated types

- Generate TypeScript types from the API's OpenAPI 3.1 spec with
  [`openapi-typescript`](https://openapi-ts.dev) (dev dependency), from the **tagged** spec so the build is
  reproducible:

  ```json
  "api:types": "openapi-typescript https://raw.githubusercontent.com/JohnReySeguma/dev-flow-be/v0.1.0/docs/openapi.json -o lib/api/schema.d.ts"
  ```

- Commit `lib/api/schema.d.ts`. Bump the tag in the script whenever you integrate a new API release.
- The frontend repo also keeps a readable snapshot of the spec at `docs/openapi.json`, refreshed from the same tag at
  each integration step. The API repo's copy stays the source of truth.
- Data shapes match `lib/tracker/types.ts` field for field. If a generated type and a hand-written one disagree,
  report it.

### 4.3 API client (`lib/api/client.ts`)

A thin `fetch` wrapper; every API call goes through it.

- Prefixes `NEXT_PUBLIC_API_URL`, sends JSON, and always sets **`credentials: "include"`**. Session cookies
  (from API `v0.2.0`) depend on it.
- Calls the API **from the browser** (client components). `localhost:3000` and `localhost:4000` are the same site, so
  the API's `SameSite=Lax` cookies flow; server-side fetches in Next.js would not carry the user's cookies.
- Parses errors: any non-2xx response is `application/problem+json`. Throw a typed `ApiError` carrying `status`,
  `code`, `detail`, `requestId` and, for `422`, `errors: [{ field, message }]`. See `INTEGRATION.md` §4.
- Network failures (API down) throw a distinct error, so the UI can say "Can't reach the server" rather than
  showing a generic failure.

### 4.4 Error presentation

- Switch on `code`, never on `title` or `detail`. Keep one map from code to a user-facing message (for example
  `lib/api/errors.ts`) covering the whole catalogue in `INTEGRATION.md` §4, including the reserved codes.
- `VALIDATION_FAILED`: show each `errors[].message` next to its field (`field` is the input's name).
- `INTERNAL_ERROR`: show a generic message plus the `requestId`, so a user can report it.

### 4.5 Migrating the store

`lib/tracker/store.ts` is synchronous; the API is not. When data endpoints arrive (API `v0.4.0`+):

- Keep the exported function **names** so components barely change, but make mutations return Promises.
- Update optimistically (apply to the local snapshot immediately), then reconcile with the server's response; on
  error, roll back and show the code's message.
- Load data with `GET /workspaces/:ws/bootstrap` (once per workspace) and `GET /workspaces/:ws/projects/:key/snapshot`
  (per project) instead of the seed.
- In demo mode, the current local implementation stays behind the same interface.

## 5. Integration roadmap

Steps 1–3 integrated API v1. API v2 (multiple workspaces) changed every path, so the remaining steps target v2;
v1's projects, sprints and Live Sync steps were never integrated and are folded in below. ✅ on a step: integrated;
✅ on an API release: released and ready to integrate.

| Step | API release        | Frontend release | Integrate                                                                                                                                                                                                                                                                 |
| ---- | ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 ✅ | `v0.1.0`           | `v1.1.0`         | §4.1–4.4: config, generated types, API client, error model. `GET /config` hides OAuth buttons that the server has disabled.                                                                                                                                               |
| 2 ✅ | `v0.2.0`           | `v1.2.0`         | Real sign-in, sign-up, logout; session check on load (`401` → `/login`); refresh once on `TOKEN_EXPIRED` (one refresh in flight at a time, see INTEGRATION §5.3); OAuth redirect; forgot password and a new `/reset-password` page; profile (`PATCH /me`); access tokens. |
| 3 ✅ | `v0.3.0`           | `v1.3.0`         | Team members, roles and invites; a new `/invite` page; hide write actions from viewers; replace the remove-member undo with a confirmation (see INTEGRATION §5.9).                                                                                                        |
| 4 ✅ | `v2.0.0-beta.2` ✅ | `v1.4.0`         | **Move to API v2, workspace switcher and "Create workspace"** (§7): `/api/v2` paths, `/auth/me` workspaces, the current workspace in the URL, switcher, create / rename / delete / leave, per-workspace roles, tokens bound to a workspace, demo locks.                   |
| 5 ✅ | `v2.0.0-beta.2` ✅ | `v1.5.0`         | Under `/workspaces/:ws`: `/bootstrap`, project snapshot, projects, workflow statuses, issues, ranking, comments, sample-data reset (§4.5); keep sprint actions local until Step 6. Switching workspaces reloads the store.                                                |
| 6 ✅ | `v2.0.0-beta.2` ✅ | `v1.6.0`         | Sprint lifecycle and reports (burndown, velocity, history), under `/workspaces/:ws`.                                                                                                                                                                                      |
| 7 ✅ | `v2.0.0-beta.3` ✅ | `v1.7.0`         | Invites for people who already have an account: the `/invite` page asks them to sign in and join instead of creating an account; the new workspace appears in the switcher.                                                                                               |
| 8 ✅ | `v2.0.0-beta.4` ✅ | `v1.8.0`         | Email verification (verify page, "verify your email" banner, resend; unverified users cannot invite), `RATE_LIMITED` handling (INTEGRATION §4.1) including the limit on creating workspaces.                                                                              |
| 9 ✅ | `v2.0.0-beta.5` ✅ | `v1.9.0`         | Live Sync per workspace: join `{ workspace, projectKey }`, apply events, ignore your own `actorId`, re-fetch after reconnecting; presence avatars; `Issue.git` badges; connecting a GitHub App installation in workspace settings.                                        |
| 10   | `v2.0.0` ✅        | `v2.0.0`         | Final contract review; API mode becomes the default.                                                                                                                                                                                                                      |

API `v2.0.0` changes nothing since `beta.5`: it makes that contract stable. Each API release's
`CHANGELOG.md` entry has a **Frontend impact** section that is the authoritative list for that step. Exact paths,
payloads and examples are in `INTEGRATION.md` and Swagger UI.

## 6. Step 1 — integrate API `v0.1.0` (`feat/api-client` → frontend `v1.1.0`)

What the API offers today: `GET /config`, `GET /health`, `GET /health/ready`, and problem+json errors (try
`GET /api/v1/nope` for a 404).

1. **Configuration (§4.1):** `NEXT_PUBLIC_API_URL`, the API-mode helper and `.env.example`.
2. **Types (§4.2):** `openapi-typescript`, the `api:types` script and the committed `lib/api/schema.d.ts`.
3. **Client and errors (§4.3–4.4):** `ApiError`, the network error, and the code-to-message map for the full
   catalogue.
4. **Feature flags:** in API mode, fetch `GET /config` on the auth pages and render "Continue with GitHub" and
   "Continue with Google" only when `oauth.github` / `oauth.google` are true. While loading, don't flash buttons that
   may disappear. If the API is unreachable, hide both and keep email sign-in usable. In demo mode, keep today's
   behaviour. The buttons still use the simulated flow until API `v0.2.0` adds real OAuth.
5. **Docs and release:** README section "Connecting to the API", a `CHANGELOG.md` entry and release `v1.1.0`.

**Done when:**

- With `NEXT_PUBLIC_API_URL` unset, the app behaves exactly as `v1.0.0`.
- With it set and the API running, the auth pages show only the providers `/config` enables.
- With it set and the API stopped, the auth pages still render and email sign-in stays usable.
- `npm run lint` and `npm run build` pass.

## 7. Step 4 — move to API v2 (`feat/api-v2` → frontend `v1.4.0`)

API `v2.0.0-beta.2` is multi-workspace. Read INTEGRATION §1.2 and §5.10 first, then the `2.0.0-beta.2` **Frontend
impact** list in the API's `CHANGELOG.md`. Nothing from v1 keeps working: `/api/v1` answers `404`, and v1 session
cookies are not sent to `/api/v2`, so everyone signs in again once.

1. **Base URL and types:** `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v2` in `.env.example` (tell the owner to
   change `.env.local`, which is theirs); bump `api:types` to the `v2.0.0-beta.2` tag, regenerate
   `lib/api/schema.d.ts` and refresh `docs/openapi.json`. Fix every call the new types flag.
2. **Session:** `GET /auth/me` (and sign-up, sign-in, invite acceptance) returns `{ user, workspaces }`. The profile
   has no `role` any more; read the role from the current workspace. `user.isDemo` marks a shared demo account.
3. **Current workspace in the URL:** put the slug in the frontend's routes (e.g. `/w/[slug]/projects`, agree the
   shape with the owner before moving pages), so links are shareable. Redirects that land on `/projects` (OAuth,
   sign-in) go to the last workspace used (remember it locally) or the first in `workspaces`. A `404` on the
   workspace itself means it is gone or you were removed: refresh `/auth/me` and switch. No workspaces at all →
   a "Create your first workspace" screen.
4. **Workspace switcher** in the sidebar: every workspace from `/auth/me` with your role, the demo one marked; picking
   one navigates to its slug.
5. **"Create workspace"** dialog (from the switcher): name (1–48) and a "Start with sample projects" checkbox
   (default on) → `POST /workspaces { name, sampleData }` → navigate to the returned slug. Hide it for demo accounts.
6. **Workspace settings:** rename (admins; the slug stays), delete (admins; confirm by typing the name, it cannot be
   undone) and leave (anyone; `409 LAST_ADMIN` shows its `detail`: promote someone, or delete instead).
7. **Members and invites** move to `/workspaces/:ws/members` and `/workspaces/:ws/invites`; removing a member now ends
   only their membership (update the confirmation text). Accepting an invite signs the person in to **that**
   workspace: continue there.
8. **Access tokens:** the Generate dialog picks the workspace the token works in (default: the current one); the list
   shows each token's workspace.
9. **Demo locks:** when `workspace.isDemo`, hide rename, delete, leave, invites and member changes; when
   `user.isDemo`, show the profile and tokens read-only and hide "Create workspace". Add `DEMO_WORKSPACE_LOCKED`,
   `DEMO_ACCOUNT_LOCKED` and the OAuth error `oauth_account_locked` to the message map.
10. **Docs and release:** README, a `CHANGELOG.md` entry and release `v1.4.0`.

The tracker screens (board, backlog, reports) stay on the local store until Step 5; keep them working inside the
workspace routes.

**Done when:**

- With `NEXT_PUBLIC_API_URL` unset, the app behaves exactly as `v1.3.0`.
- With it set: a new sign-up lands in its own workspace; `demo@devflow.local` sees Acme Inc with the locks; creating,
  renaming, deleting, leaving and switching workspaces work; the members page and tokens work inside a workspace.
- `npm run lint` and `npm run build` pass.
