# Admin CMS Worker — Progress & Next Steps

**Last updated:** April 2026

---

## What's been built

### Endpoints

| Method | Route | Status |
|--------|-------|--------|
| POST | `/api/login` | Done |
| GET | `/api/files/:filePath` | Done |
| GET | `/api/directory/:dir` | Done |
| POST | `/api/pr` | Not started |
| POST | `/api/images` | Not started |
| GET | `/api/pr` | Not started |

### Auth (`POST /api/login`)
Validates username/password against bcrypt-hashed credentials stored in Cloudflare KV (`ADMIN_USERNAME`, `ADMIN_PASSWORD`). Returns a signed HS256 JWT (24h expiry). All subsequent endpoints validate this JWT from the `Authorization: Bearer` header.

### File read (`GET /api/files/:filePath`)
Fetches a file from the repo via the GitHub Contents API. Returns `{ content, sha }` where `content` is base64-encoded (as returned by GitHub). The file SHA is needed later when committing edits.

Paths use `%2F` encoding (e.g., `src%2Fjson%2Fpress.json`) since Hono's `:param` stops at a real `/`.

### Directory read (`GET /api/directory/:dir`)
Given a path like `src%2Fjson`, walks to the target directory via the Git Trees API then fetches its full contents recursively:
1. `GET /git/refs/heads/{branch}` → commit SHA
2. `GET /git/commits/{sha}` → root tree SHA
3. Walk one tree per path segment until the target is reached
4. `GET /git/trees/{sha}?recursive=1` → all entries under the directory

Returns `{ tree, truncated }` where `tree` is a nested object. Blob entries are `{ type: "blob", sha, size }` and subdirectories are `{ type: "tree", children: { ... } }`. `truncated` is `true` if GitHub capped the response at 100,000 entries.

### CORS (`/api/*`)
Per-request Hono middleware using `hono/cors`. Checks `Origin` against the `ALLOWED_ORIGIN` env var and handles `OPTIONS` preflight with `Access-Control-Allow-Methods: GET, POST, OPTIONS` and `Access-Control-Allow-Headers: Content-Type, Authorization`.

### Tests (`src/index.test.ts`)
Vitest unit tests using `app.fetch()` directly with a mocked env (no HTTP server or Workers runtime needed). GitHub API calls are stubbed via `vi.stubGlobal("fetch", ...)`.

Covers:
- Incorrect credentials (wrong password, wrong username) → 401
- Full happy path: login → directory tree → file fetch

---

## Deviations from the original plan

- Routes are prefixed `/api/` (e.g., `/api/login` not `/login`) — consistent with chanfana/OpenAPI setup.
- Directory lookup is a single route that returns the full recursive tree, rather than two split routes (fetch SHA, then list by SHA).
- `GITHUB_TARGET_BRANCH` is used as the env var name (matches `wrangler.jsonc`); the plan referred to `GITHUB_BASE_BRANCH`.

---

## Next steps

### 1. `POST /api/pr` — Submit staged changes as a PR

Use the **Git Data API** for atomicity (per the evaluation — avoids partial commits if one file fails):

```
1. For each staged file: re-fetch its current SHA via GET /contents/{path}
   (detects if file was modified since the admin loaded it)
2. GET /git/refs/heads/master → HEAD commit SHA
3. GET /git/commits/{sha} → root tree SHA
4. POST /git/blobs for each changed file (base64 content)
5. POST /git/trees with base_tree + all new blobs
6. POST /git/commits with new tree + parent commit
7. POST /git/refs → create branch admin/update-{timestamp}
8. POST /pulls → open PR targeting master (optionally draft: true)
```

Request body from the frontend:
```json
{
  "title": "PR title",
  "description": "optional body",
  "files": [
    { "path": "src/json/press.json", "content": "<base64>", "sha": "<original sha>" }
  ]
}
```

Returns `{ prUrl }`.

### 2. `GET /api/pr` — List open admin PRs

List open PRs whose `head.ref` starts with `admin/`. Lets the frontend show in-flight submissions and link to them on GitHub.

### 3. `POST /api/images` — Image upload

Accept `{ filename, folder, contentBase64 }`, write the file to the repo at commit time (include it in the same Git Data API tree as step 5 above), or stage it separately and merge into the PR payload.

### 4. React frontend

Per the plan, new files under `src/pages/admin/` in the GitHub Pages repo:
- `AdminLogin.js` — credentials form, stores JWT in `localStorage` key `purpl_admin_token`
- `AdminDashboard.js` — auth guard, tab layout (Files | Images | PRs)
- `FileEditor.js` — Monaco editor, stages edits in `localStorage` alongside the file SHA
- `ImageUploader.js` — drag-and-drop, base64 via FileReader, staged locally

Route registration goes in `src/components/navbar/Router.js` only (not `routing.js`).

---

## Open questions

- **Draft PRs?** The evaluation recommends `"draft": true` on `POST /pulls`. Confirm with the webmaster whether draft PRs fit their review workflow.
- **Stale file detection:** The PR flow re-fetches SHAs at submit time. Should the frontend also warn the admin before they start editing if the file was recently touched by someone else?
- **KV credential management:** Currently the webmaster must set `ADMIN_USERNAME` and `ADMIN_PASSWORD` via `wrangler kv` CLI or the Cloudflare dashboard. A small admin-bootstrap script would reduce friction.
