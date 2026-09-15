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
