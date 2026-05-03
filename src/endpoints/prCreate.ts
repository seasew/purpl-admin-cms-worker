import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { verify } from "hono/jwt";

const PRFile = z.object({
	path: Str({ description: "File path relative to repo root (e.g., src/json/press.json)" }),
	content: Str({ description: "File content, base64 encoded" }),
	sha: Str({ description: "SHA of the file when it was loaded — used to detect concurrent edits" }),
});

const PRRequest = z.object({
	title: Str({ description: "Pull request title" }),
	description: z.string().optional(),
	files: z.array(PRFile).min(1),
});

const PRResponse = z.object({
	prUrl: Str({ description: "URL of the created pull request on GitHub" }),
	branch: Str({ description: "Branch name created for this PR" }),
});

export class PRCreate extends OpenAPIRoute {
	schema = {
		tags: ["Admin"],
		summary: "Commit staged file changes and open a pull request",
		request: {
			body: {
				content: {
					"application/json": {
						schema: PRRequest,
					},
				},
			},
			headers: z.object({
				authorization: Str({ example: "Bearer <jwt_token>" }),
			}),
		},
		responses: {
			"200": {
				description: "Pull request created successfully",
				content: {
					"application/json": {
						schema: PRResponse,
					},
				},
			},
			"400": { description: "Invalid request body" },
			"401": { description: "Unauthorized - invalid or missing JWT" },
			"409": { description: "One or more files were modified since they were loaded" },
			"500": { description: "GitHub API error" },
		},
	};

	async handle(c: AppContext) {
		const authHeader = c.req.header("authorization");
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return c.json({ error: "Missing or invalid authorization header" }, { status: 401 });
		}
		try {
			await verify(authHeader.slice(7), c.env.JWT_SECRET, "HS256");
		} catch {
			return c.json({ error: "Invalid token" }, { status: 401 });
		}

		const body = await c.req.json();
		const result = PRRequest.safeParse(body);
		if (!result.success) {
			return c.json({ error: "Invalid request body" }, { status: 400 });
		}
		const { title, description, files } = result.data;

		const githubHeaders = {
			Authorization: `Bearer ${c.env.GITHUB_PAT}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "purpl-cms-worker",
		};
		const base = `https://api.github.com/repos/${c.env.GITHUB_OWNER}/${c.env.GITHUB_REPO}`;

		try {
			// Step 1: Re-fetch current SHA for each file in parallel to detect staleness
			const shaChecks = await Promise.all(
				files.map(async (file) => {
					const res = await fetch(`${base}/contents/${file.path}`, { headers: githubHeaders });
					if (!res.ok) {
						return { path: file.path, error: true, currentSha: null };
					}
					const data = await res.json() as { sha: string };
					return { path: file.path, error: false, currentSha: data.sha };
				})
			);

			for (let i = 0; i < shaChecks.length; i++) {
				const check = shaChecks[i];
				if (check.error) {
					return c.json({ error: `Failed to verify file: ${check.path}` }, { status: 500 });
				}
				if (check.currentSha !== files[i].sha) {
					return c.json(
						{ error: `File was modified since it was loaded: ${check.path}` },
						{ status: 409 }
					);
				}
			}

			// Step 2: Get HEAD commit SHA for target branch
			const refRes = await fetch(
				`${base}/git/refs/heads/${c.env.GITHUB_TARGET_BRANCH}`,
				{ headers: githubHeaders }
			);
			if (!refRes.ok) {
				console.error(`Failed to fetch branch ref: ${refRes.status} ${refRes.statusText}`);
				return c.json({ error: "Failed to fetch branch reference" }, { status: 500 });
			}
			const headCommitSha = (await refRes.json() as { object: { sha: string } }).object.sha;

			// Step 3: Get root tree SHA from the HEAD commit
			const commitRes = await fetch(
				`${base}/git/commits/${headCommitSha}`,
				{ headers: githubHeaders }
			);
			if (!commitRes.ok) {
				console.error(`Failed to fetch commit: ${commitRes.status} ${commitRes.statusText}`);
				return c.json({ error: "Failed to fetch commit" }, { status: 500 });
			}
			const rootTreeSha = (await commitRes.json() as { tree: { sha: string } }).tree.sha;

			// Step 4: Create a new tree with all file changes at once
			// Decode base64 content to raw string for the GitHub Trees API
			const treeEntries = files.map((file) => ({
				path: file.path,
				mode: "100644",
				type: "blob",
				content: atob(file.content.replace(/\n/g, "")),
			}));
			const newTreeRes = await fetch(`${base}/git/trees`, {
				method: "POST",
				headers: { ...githubHeaders, "Content-Type": "application/json" },
				body: JSON.stringify({ base_tree: rootTreeSha, tree: treeEntries }),
			});
			if (!newTreeRes.ok) {
				console.error(`Failed to create tree: ${newTreeRes.status} ${newTreeRes.statusText}`);
				return c.json({ error: "Failed to create tree" }, { status: 500 });
			}
			const newTreeSha = (await newTreeRes.json() as { sha: string }).sha;

			// Step 5: Create a commit pointing to the new tree
			const newCommitRes = await fetch(`${base}/git/commits`, {
				method: "POST",
				headers: { ...githubHeaders, "Content-Type": "application/json" },
				body: JSON.stringify({
					message: title,
					tree: newTreeSha,
					parents: [headCommitSha],
				}),
			});
			if (!newCommitRes.ok) {
				console.error(`Failed to create commit: ${newCommitRes.status} ${newCommitRes.statusText}`);
				return c.json({ error: "Failed to create commit" }, { status: 500 });
			}
			const newCommitSha = (await newCommitRes.json() as { sha: string }).sha;

			// Step 6: Create a new branch ref pointing to the new commit
			const branch = `admin/update-${Date.now()}`;
			const branchRes = await fetch(`${base}/git/refs`, {
				method: "POST",
				headers: { ...githubHeaders, "Content-Type": "application/json" },
				body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: newCommitSha }),
			});
			if (!branchRes.ok) {
				console.error(`Failed to create branch: ${branchRes.status} ${branchRes.statusText}`);
				return c.json({ error: "Failed to create branch" }, { status: 500 });
			}

			// Step 7: Open a draft pull request
			const prRes = await fetch(`${base}/pulls`, {
				method: "POST",
				headers: { ...githubHeaders, "Content-Type": "application/json" },
				body: JSON.stringify({
					title,
					body: description ?? "",
					head: branch,
					base: c.env.GITHUB_TARGET_BRANCH,
					draft: true,
				}),
			});
			if (!prRes.ok) {
				console.error(`Failed to create PR: ${prRes.status} ${prRes.statusText}`);
				return c.json({ error: "Failed to open pull request" }, { status: 500 });
			}
			const prData = await prRes.json() as { html_url: string };

			return c.json({ prUrl: prData.html_url, branch });
		} catch (error) {
			console.error("Error creating PR:", error);
			return c.json({ error: "Internal server error" }, { status: 500 });
		}
	}
}
