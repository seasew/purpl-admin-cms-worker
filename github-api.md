## File Operations

PUT /repos/{owner}/{repo}/contents/{path}
- create or update file contents (with a commit message)
The fine-grained token must have the following permission set:

    "Contents" repository permissions (read)

GET /repos/{owner}/{repo}/contents/{path}
- gets repository content
- Example path: https://api.github.com/repos/google/tracing-framework/contents/index.html\?ref=gh-pages
The fine-grained token must have at least one of the following permission sets:

    "Contents" repository permissions (write)
    "Contents" repository permissions (write) and "Workflows" repository permissions (write)

## Git Operations (for branching and pushing)

GET /repos/{owner}/{repo}/git/refs/{ref}
- get a git reference (branch or tag)
- used to find the commit SHA of a branch (e.g., refs/heads/master)
The fine-grained token must have the following permission set:

    "Contents" repository permissions (read)

GET /repos/{owner}/{repo}/git/trees/{tree_sha}
- get a tree object by SHA
- contains file/folder entries
The fine-grained token must have the following permission set:

    "Contents" repository permissions (read)

POST /repos/{owner}/{repo}/git/trees
- create a new tree based on parent tree with file changes
- request body: `{ base_tree, tree: [{ path, mode, type, sha/content }, ...] }`
The fine-grained token must have the following permission set:

    "Contents" repository permissions (write)

POST /repos/{owner}/{repo}/git/commits
- create a new commit pointing to a tree
- request body: `{ message, tree, parents: [parent_commit_sha, ...], author, committer }`
The fine-grained token must have the following permission set:

    "Contents" repository permissions (write)

POST /repos/{owner}/{repo}/git/refs
- create a new reference (branch)
- request body: `{ ref: "refs/heads/branch-name", sha: "commit-sha" }`
The fine-grained token must have at least one of the following permission sets:

    "Contents" repository permissions (write)
    "Contents" repository permissions (write) and "Workflows" repository permissions (write)

PATCH /repos/{owner}/{repo}/git/refs/{ref}
- Updates the provided reference to point to a new SHA. 
The fine-grained token must have at least one of the following permission sets:

    "Contents" repository permissions (write)
    "Contents" repository permissions (write) and "Workflows" repository permissions (write)

## Pull Request Operations

POST /repos/{owner}/{repo}/pulls
- Create a pull request
The fine-grained token must have the following permission set:
    "Pull requests" repository permissions (write)

