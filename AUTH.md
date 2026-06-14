# Auth setup (Google sign-in)

This app uses [Auth.js / NextAuth v5](https://authjs.dev) with Google as the
only sign-in provider and JWT sessions (no database adapter). Sign-in is gated
by an **allowlist**: only specific emails may log in, each mapped to one of the
five managers.

The app builds and runs with auth env vars **unset** — the header just shows a
non-functional "Sign in" label until you complete the steps below. Nothing
breaks before credentials exist.

## What you (the human) must do

### 1. Create a Google OAuth 2.0 Client

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: configure it (External user
   type is fine). Add your testers' Google accounts under **Test users** while
   the app is in "Testing" status, or publish it.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - **Authorized redirect URIs** — add BOTH of these exactly:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://the-boys-are-back-in-cup.vercel.app/api/auth/callback/google`
   - (Add the redirect URI for any other deployment domain you use, e.g. a
     custom domain or a stable Vercel preview URL.)
4. Copy the **Client ID** and **Client secret**.

### 2. Set environment variables

| Variable             | Where                | Value                                                        |
| -------------------- | -------------------- | ------------------------------------------------------------ |
| `AUTH_SECRET`        | local + Vercel       | `openssl rand -base64 32` (one value, reuse across envs)     |
| `AUTH_GOOGLE_ID`     | local + Vercel       | OAuth **Client ID** from step 1                              |
| `AUTH_GOOGLE_SECRET` | local + Vercel       | OAuth **Client secret** from step 1                          |
| `AUTH_ALLOWLIST`     | local + Vercel       | `email:Manager` pairs — see below                            |

**Local:** these go in `.env.local` (gitignored). A generated `AUTH_SECRET` is
already there; add the three others to test the full flow locally.

**Vercel:** Project → Settings → Environment Variables. Add all four for the
Production (and Preview, if you want sign-in on previews) environments, then
redeploy.

### 3. AUTH_ALLOWLIST format

Comma-separated `email:Manager` pairs. The manager must be one of:
`Brian`, `Nathan`, `Dan`, `Mattie`, `Dereck`. Emails are matched
case-insensitively. Any email not in the list is rejected at sign-in.

```
AUTH_ALLOWLIST=alice@gmail.com:Brian,bob@gmail.com:Nathan,carol@gmail.com:Dan
```

(Those are fake addresses — substitute the managers' real Google emails. Keep
this value in env vars only; the repo is public.)

## How it fits together

- `auth.ts` — NextAuth config. Google provider (only registered when
  `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set), JWT sessions, and the
  allowlist gate in the `signIn` callback. The `jwt`/`session` callbacks attach
  `session.user.manager` and `session.user.personId`.
- `lib/allowlist.ts` — parses `AUTH_ALLOWLIST` and resolves an email → manager.
- `lib/people.ts` — on sign-in, writes the email onto the matching manager's
  `people` row (new nullable `email` column, added via the `ensureColumns`
  additive-migration pattern in `lib/db.ts`).
- `lib/auth-guard.ts` — `getCurrentManager()` returns
  `{ manager, personId } | null`; `requireManager()` redirects to sign-in when
  logged out. Future betting routes should use these.
- `components/AuthControl.tsx` — the header sign-in/out control.

## Verifying after setup

1. Visit the site, click **Sign in with Google**, complete the Google flow.
2. An allowlisted email lands back signed in, showing the manager's name (in
   their color) and a **Sign out** link.
3. A non-allowlisted email is bounced back to the sign-in screen (rejected).
