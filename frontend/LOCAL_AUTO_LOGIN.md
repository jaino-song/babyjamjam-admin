# Local automatic login

Desktop `pnpm qa:fe` and mobile `pnpm qa:mobile -- --port <port>` bind to
`127.0.0.1`. With both `LOCAL_AUTO_LOGIN_EMAIL` and
`LOCAL_AUTO_LOGIN_PASSWORD` in the git-ignored `frontend/.env.local`, opening `/`,
`/login`, or a protected page without session cookies signs in through the existing
backend password-login endpoint. Existing permissions and branch selection still apply.

The QA launchers pass only the two server-only credentials and the loopback backend
origin from `frontend/.env.local` into the selected app. This keeps one local source of
truth while allowing every task worktree to QA either app after `env-bootstrap`.

This requires development mode and loopback HTTP addresses for both the frontend
and its configured backend API. Vercel/Railway environments, cross-site requests,
API routes, and existing sessions do not initiate automatic login. Credentials
must never be set on deployments or given `NEXT_PUBLIC_` names. Do not expose this
development server through a tunnel or reverse proxy.

The backend must be running locally. Invalid credentials or an unavailable backend
fall back to the regular login screen. Remove or blank either setting and restart
the frontend to disable automatic login. Logging out clears the session; the next
eligible navigation signs in again while these settings remain enabled.

The QA launchers fail before starting when credentials are missing or the backend is
not loopback HTTP. Do not use `next start` for automatic-login QA because production
mode intentionally retains the regular login boundary.

After changing the local credentials, back up the local file yourself with
`env-backup frontend/.env.local`. The committed manifest contains blank values only.


## Plain dev servers

The regular dev commands use the same settings, so agents and people never hit the login
screen locally:

- Admin web: `pnpm run dev` in `frontend/` (binds `127.0.0.1`, reads `frontend/.env.local`).
- Mobile: `pnpm run dev` in `mobile/` runs `scripts/start-mobile-dev.mjs`, which borrows
  `LOCAL_AUTO_LOGIN_*` and the loopback backend origin from `frontend/.env.local` and starts
  `next dev` as before. Without those settings it starts without automatic login.
- Backend: `pnpm run start:dev` reads `backend/.env`; `AUTH_RATE_LIMIT_DISABLED=true` there turns
  the login rate limit off locally (ignored when `NODE_ENV=production`).

Optional `LOCAL_AUTO_LOGIN_BRANCH_NAME` (exact branch name) selects that branch right after the
automatic login, skipping `/select-branch`. If the name is not found or selection fails, the
session stays signed in and the branch screen appears as usual.

The mobile dev server listens on the LAN so phones can open service-record links. Automatic
login only answers requests addressed to `localhost`/`127.0.0.1`, but a device on the same
network can forge that `Host` header and receive a signed-in session (accepted for local
development on 2026-10-15). On shared networks use `pnpm qa:mobile`, which listens on
loopback only.
