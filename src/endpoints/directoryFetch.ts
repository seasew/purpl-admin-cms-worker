import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { verify } from "hono/jwt";

type FileNode = { type: "blob"; sha: string; size: number };
type DirNode = { type: "tree"; children: Record<string, FileNode | DirNode> };
type TreeNode = FileNode | DirNode;

function buildTree(
	entries: Array<{ path: string; type: string; sha: string; size?: number }>
): Record<string, TreeNode> {
	const root: Record<string, TreeNode> = {};
	for (const entry of entries) {
		const parts = entry.path.split("/");
		let node = root as Record<string, TreeNode>;
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i];
			if (!node[part]) {
				node[part] = { type: "tree", children: {} };
			}
			node = (node[part] as DirNode).children;
		}
		const name = parts[parts.length - 1];
		if (entry.type === "blob") {
			node[name] = { type: "blob", sha: entry.sha, size: entry.size ?? 0 };
		} else if (entry.type === "tree" && !node[name]) {
			node[name] = { type: "tree", children: {} };
		}
	}
	return root;
}

export class DirectoryFetch extends OpenAPIRoute {
	schema = {
		tags: ["Admin"],
		summary: "Read all files under a repository directory as a nested tree",
		request: {
			params: z.object({
				dir: Str({ description: "Target directory path relative to repo root (e.g., src%2Fjson)" }),
			}),
			headers: z.object({
				authorization: Str({ example: "Bearer <jwt_token>" }),
			}),
		},
		responses: {
			"200": {
				description: "Directory tree fetched successfully",
				content: {
					"application/json": {
						schema: z.object({
							tree: z.record(z.any()),
							truncated: z.boolean(),
						}),
					},
				},
			},
			"401": { description: "Unauthorized - invalid or missing JWT" },
			"404": { description: "Directory not found" },
			"500": { description: "Error fetching directory from GitHub" },
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

		const dir = c.req.param("dir");
		if (!dir) {
			return c.json({ error: "Directory path is required" }, { status: 400 });
		}

		const segments = dir.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
		const githubHeaders = {
			Authorization: `Bearer ${c.env.GITHUB_PAT}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "purpl-cms-worker",
		};
		const base = `https://api.github.com/repos/${c.env.GITHUB_OWNER}/${c.env.GITHUB_REPO}`;

		try {
			// Get commit SHA for target branch
			const refRes = await fetch(
				`${base}/git/refs/heads/${c.env.GITHUB_TARGET_BRANCH}`,
				{ headers: githubHeaders }
			);
			if (!refRes.ok) {
				console.error(`Failed to fetch branch ref: ${refRes.status} ${refRes.statusText}`);
				return c.json({ error: "Failed to fetch branch reference" }, { status: 500 });
			}
			const commitSha = (await refRes.json() as { object: { sha: string } }).object.sha;

			// Get root tree SHA from the commit
			const commitRes = await fetch(
				`${base}/git/commits/${commitSha}`,
				{ headers: githubHeaders }
			);
			if (!commitRes.ok) {
				console.error(`Failed to fetch commit: ${commitRes.status} ${commitRes.statusText}`);
				return c.json({ error: "Failed to fetch commit" }, { status: 500 });
			}
			let treeSha = (await commitRes.json() as { tree: { sha: string } }).tree.sha;

			// Walk the tree along each path segment to reach the target directory
			for (const segment of segments) {
				const treeRes = await fetch(
					`${base}/git/trees/${treeSha}`,
					{ headers: githubHeaders }
				);
				if (!treeRes.ok) {
					console.error(`Failed to fetch tree: ${treeRes.status} ${treeRes.statusText}`);
					return c.json({ error: "Failed to fetch tree" }, { status: 500 });
				}
				const treeData = await treeRes.json() as {
					tree: Array<{ path: string; type: string; sha: string }>;
				};
				const entry = treeData.tree.find((e) => e.path === segment && e.type === "tree");
				if (!entry) {
					return c.json({ error: `Directory not found: ${segment}` }, { status: 404 });
				}
				treeSha = entry.sha;
			}

			// Fetch the full recursive tree for the target directory
			const recursiveRes = await fetch(
				`${base}/git/trees/${treeSha}?recursive=1`,
				{ headers: githubHeaders }
			);
			if (!recursiveRes.ok) {
				console.error(`Failed to fetch recursive tree: ${recursiveRes.status} ${recursiveRes.statusText}`);
				return c.json({ error: "Failed to fetch directory tree" }, { status: 500 });
			}
			const recursiveData = await recursiveRes.json() as {
				tree: Array<{ path: string; type: string; sha: string; size?: number }>;
				truncated: boolean;
			};

			return c.json({ tree: buildTree(recursiveData.tree), truncated: recursiveData.truncated });
		} catch (error) {
			console.error("Error fetching directory:", error);
			return c.json({ error: "Internal server error" }, { status: 500 });
		}
	}
}
