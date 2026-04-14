# Admin CMS File Edit Flow — Evaluation

## Evaluation

### localStorage vs. React state

The plan specifies React state; the proposed approach uses localStorage. Both are valid, but they behave differently:

| | React state | localStorage |
|---|---|---|
| Survives page refresh | No | Yes |
| Survives browser close | No | Yes |
| Multi-tab safe | Yes (isolated) | No (shared, can diverge) |
| Stale data risk | Low | High |

For non-technical admins, localStorage is probably better — they shouldn't lose work on accidental refresh. But you'd need to store the file SHA alongside the content, and invalidate it when they load a fresh copy.

---

## Question 1: Should "Push to Branch" and "Open PR" be separate buttons?

**No, I'd recommend against two separate buttons.** Here's why:

- **Orphaned branches.** If admin pushes a branch but never opens a PR, you accumulate dead branches. There's no cleanup mechanism.
- **Branch identity problem.** After pushing to a branch, if the admin loads more files and makes more edits, should the next push go to the *same* branch or a *new one*? You'd need to persist the branch name in localStorage too, and handle the case where that branch was deleted or merged.
- **Non-technical users don't think in branches.** "Push to branch" is a git concept. "Submit for webmaster review" is the mental model that makes sense here.

**Better alternative:** A single "Submit for Review" button that atomically creates the branch, commits all staged changes, and opens a PR — exactly as the plan describes. If the admin wants to share a preview before it's ready, use a **GitHub draft PR** instead of a bare branch. You can open draft PRs via the API by adding `"draft": true` to the `POST /pulls` body.

---

## Question 2: Potential Issues

### Issue 1: Partial commit on multi-file PR
The plan's `/pr` flow commits files one at a time via `PUT /contents`. If commit #2 of 4 fails, the branch is left in a half-updated state with no rollback. The fix: use the **Git Data API** (create blobs → create tree → create commit → update ref) which is atomic across all files. This also avoids repeated round-trips.

### Issue 3: Concurrent admin sessions
Two admins editing the same file will silently create a conflict. There's no lock mechanism. A lightweight fix: store a `last_edited_by` and `last_edited_at` in KV when a file is fetched, and warn (not block) if another admin has it open.

### Issue 4: Cloudflare CPU limit
The plan already notes the 10ms CPU limit on the free tier. Committing N files sequentially via the Contents API does N synchronous GitHub round-trips, which can easily exceed this. The Git Data API batches blob creation and is a single commit call — much safer within the CPU budget.

---

## Recommended Flow (revised)

```
Admin edits files → staged in localStorage (content + SHA + filePath)
        │
        ▼
"Submit for Review" button → modal for PR title/description
        │
        ▼
POST /pr:
  1. Re-fetch current SHA for each staged file (detect staleness)
  2. GET master HEAD SHA
  3. Create blobs for all changed files (Git Data API)
  4. Create tree with all blobs at once
  5. Create commit
  6. Create branch ref
  7. Open PR (draft: true optional)
        │
        ▼
Return PR URL → admin sees link, localStorage cleared
```

The key changes from the original plan: re-fetch SHAs at commit time, and use the Git Data API for atomicity.
