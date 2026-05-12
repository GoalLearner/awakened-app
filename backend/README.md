# awakened-backend

Cloudflare Workers + D1 backend for Awakened v2.1 (Sign in with Apple + global leaderboard).

**Design contract:** see `../BACKEND.md`. This README is a one-page operator's guide for deploying + maintaining the live Worker. Anything design-shaped lives in BACKEND.md.

---

## Quickstart

```bash
# 1. Install dependencies (once per fresh clone)
cd backend
npm install

# 2. Authenticate Wrangler (once per machine)
wrangler login

# 3. Run tests
npm run test

# 4. Type-check
npm run typecheck

# 5. Local dev server (Workers runtime + local D1 simulator)
npm run dev
```

---

## Deploy

```bash
cd backend
wrangler deploy
```

This bundles `src/index.ts` (TypeScript → Worker module), reads `wrangler.toml`, and publishes to `awakened-backend.<your-workers-subdomain>.workers.dev`. Deploy is atomic — in-flight requests complete against the previous version; new requests after the deploy hit the new version.

**Pre-flight checklist before deploying for the first time:**

1. D1 database created (`wrangler d1 create awakened-db`) and `database_id` set in `wrangler.toml`
2. Migration applied (`wrangler d1 execute awakened-db --remote --file=migrations/0001_initial.sql`)
3. All 3 secrets set:
   - `JWT_SIGNING_KEY` (32-byte hex; generate with `openssl rand -hex 32`)
   - `APPLE_BUNDLE_ID` (literal: `com.goallearner.awakened`)
   - `APPLE_TEAM_ID` (literal: `LK8FVGBQPL`)

---

## Secrets management

```bash
# Set or rotate a secret
wrangler secret put JWT_SIGNING_KEY
# (prompts for value; pasted value is encrypted at rest in Cloudflare's vault)

# List secret names (values NOT shown)
wrangler secret list

# Delete a secret
wrangler secret delete <NAME>
```

**Secrets never go in `wrangler.toml` or any committed file.** They're stored encrypted in Cloudflare and exposed to the Worker only as `env.<NAME>` at runtime.

| Secret name | Value | Source |
|---|---|---|
| `JWT_SIGNING_KEY` | 32-byte hex string | `openssl rand -hex 32` (one-time generate; stored in password manager) |
| `APPLE_BUNDLE_ID` | `com.goallearner.awakened` | App Store Connect App ID |
| `APPLE_TEAM_ID` | `LK8FVGBQPL` | Apple Developer Portal team ID |

---

## Database migrations

Schema migrations are numbered SQL files in `migrations/`. Each file applied in order. Never edit a migration after applying it remotely — add a new numbered file instead.

```bash
# Local dry-run (uses Wrangler's local D1 simulator)
wrangler d1 execute awakened-db --local --file=migrations/0001_initial.sql

# Apply to remote (production) D1
wrangler d1 execute awakened-db --remote --file=migrations/0001_initial.sql

# Ad-hoc remote query (debugging — read-only by convention)
wrangler d1 execute awakened-db --remote --command "SELECT COUNT(*) FROM users"
```

---

## Local development

```bash
npm run dev
```

Starts a Wrangler dev server (typically `http://localhost:8787`) running the Worker against a local D1 simulator. Useful for testing endpoint logic without hitting production. Real Apple identity tokens won't verify (JWKS fetch needs network) so auth flows must be tested in staging or production.

**Environment for local dev:** add a `.dev.vars` file in `/backend/` with:

```
JWT_SIGNING_KEY=local-dev-key-replace-with-real-bytes-from-openssl
APPLE_BUNDLE_ID=com.goallearner.awakened
APPLE_TEAM_ID=LK8FVGBQPL
```

This file is `.gitignore`d — never commit. It only exists locally.

---

## Logs + monitoring

```bash
# Stream real-time Worker logs (last N minutes of console.log output)
wrangler tail

# Filter to a specific status code
wrangler tail --status error
```

---

## Project layout

```
backend/
├── package.json
├── tsconfig.json
├── wrangler.toml
├── README.md          ← this file
├── migrations/
│   └── 0001_initial.sql
└── src/
    ├── index.ts        ← Worker entry; routes to endpoint handlers
    ├── env.ts          ← Env type (D1 + secrets)
    ├── apple-jwks.ts   ← Apple identity token verifier
    ├── session-jwt.ts  ← Backend session JWT issuer + verifier
    ├── profanity.ts    ← Alias profanity filter
    └── alias-suggestions.ts ← Collision-suggestion generator
```

---

## Related docs

- `../BACKEND.md` — design contract (auth flow, schema, endpoints, decisions)
- `../CLAUDE.md` — codebase operational reference
- `../auth.js` — client-side Apple Sign-In + session JWT storage
