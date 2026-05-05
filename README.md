# PURPL CMS Worker

A Cloudflare Worker that provides a backend API for the PURPL Purdue admin CMS. It handles admin authentication, file and directory reads from GitHub, and submitting content edits as pull requests.

Built with [Hono](https://hono.dev) and [chanfana](https://github.com/cloudflare/chanfana) (OpenAPI 3.1). Interactive API docs are served at `/`.

## Setup

1. Install dependencies: `npm install`
2. Log in to Cloudflare: `npx wrangler login`
3. Set required secrets:
   ```
   npx wrangler secret put JWT_SECRET
   npx wrangler secret put GITHUB_PAT
   ```
4. Set admin credentials in KV:
   ```
   npm run set-admin
   ```
5. Deploy: `npm run deploy`

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/login` | Authenticate and receive a JWT |
| `GET` | `/api/files/:filePath` | Fetch a file from the GitHub repo |
| `GET` | `/api/directory/:dir` | Resolve a directory path to its git tree SHA |
| `GET` | `/api/directory-list/:sha` | List filenames in a git tree |
| `POST` | `/api/pr` | Submit staged file edits as a pull request |

All endpoints except `/api/login` require `Authorization: Bearer <token>`.

File paths use `%2F` encoding (e.g. `src%2Fjson%2Fpress.json`) since the path is a single route parameter.

## Authentication

Credentials are stored in Cloudflare KV:
- `ADMIN_USERNAME` — plain text
- `ADMIN_PASSWORD` — bcrypt hash

`POST /api/login` validates credentials and returns a signed HS256 JWT (24h expiry). Use `npm run set-admin` to set or rotate credentials.

## Environment

Configured in `wrangler.jsonc`. Required bindings:

| Binding | Type | Description |
|---------|------|-------------|
| `KV` | KV Namespace | Stores admin credentials |
| `JWT_SECRET` | Secret | JWT signing key |
| `GITHUB_PAT` | Secret | GitHub personal access token |
| `GITHUB_OWNER` | Var | GitHub org/user (`PURPL-Purdue`) |
| `GITHUB_REPO` | Var | Target repository |
| `GITHUB_TARGET_BRANCH` | Var | Branch to read from and target for PRs |
| `ALLOWED_ORIGIN` | Var | Allowed CORS origin |

## Development

Wrangler loads secrets from a `.dev.vars` file during local development. Create one by copying the example:

```
cp .dev.vars.example .dev.vars
```

Then fill in real values. `.dev.vars` is gitignored and never deployed.

```
npm run dev       # Start local dev server at http://localhost:8787
npm test          # Run Vitest unit tests
npm run set-admin # Set admin username and password in KV
```

## Project Structure

```
src/
  index.ts              # Hono app and route registration
  types.ts              # Shared types and Bindings
  endpoints/
    adminLogin.ts
    fileFetch.ts
    directoryFetch.ts
    prCreate.ts
scripts/
  set-admin-credentials.js   # Admin credential bootstrap script
```
