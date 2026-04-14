import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { verify } from "hono/jwt";

const DirectoryResponse = z.object({
	filePaths: z.array(Str({ description: "File path relative to repo root" })),
});

export class DirectoryFetch extends OpenAPIRoute {
	schema = {
		tags: ["Admin"],
		summary: "List all file paths in a repository directory",
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
				description: "Directory listing fetched successfully",
				content: {
					"application/json": {
						schema: DirectoryResponse,
					},
				},
			},
			"401": {
				description: "Unauthorized - invalid or missing JWT",
			},
			"404": {
				description: "Directory not found",
			},
			"500": {
				description: "Error fetching directory from GitHub",
			},
		},
	};

	async handle(c: AppContext) {
		// Validate JWT from Authorization header
		const authHeader = c.req.header("authorization");
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return c.json({ error: "Missing or invalid authorization header" }, { status: 401 });
		}

		const token = authHeader.slice(7);
		try {
			await verify(token, c.env.JWT_SECRET, "HS256");
		} catch {
			return c.json({ error: "Invalid token" }, { status: 401 });
		}

		const dir = c.req.param("dir");
		if (!dir) {
			return c.json({ error: "Directory path is required" }, { status: 400 });
		}

		// Normalize: strip leading/trailing slashes, split into segments
		const segments = dir.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);

		const githubHeaders = {
			Authorization: `Bearer ${c.env.GITHUB_PAT}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "purpl-cms-worker",
		};
		const base = `https://api.github.com/repos/${c.env.GITHUB_OWNER}/${c.env.GITHUB_REPO}`;

		try {
			// Step 1: Get commit SHA for target branch
			const refRes = await fetch(
				`${base}/git/refs/heads/${c.env.GITHUB_TARGET_BRANCH}`,
				{ headers: githubHeaders }
			);
			if (!refRes.ok) {
				console.error(`Failed to fetch branch ref: ${refRes.status} ${refRes.statusText}`);
				return c.json({ error: "Failed to fetch branch reference" }, { status: 500 });
			}
			const refData = await refRes.json() as { object: { sha: string } };
			const commitSha = refData.object.sha;

			// Step 2: Get root tree SHA from the commit
			const commitRes = await fetch(
				`${base}/git/commits/${commitSha}`,
				{ headers: githubHeaders }
			);
			if (!commitRes.ok) {
				console.error(`Failed to fetch commit: ${commitRes.status} ${commitRes.statusText}`);
				return c.json({ error: "Failed to fetch commit" }, { status: 500 });
			}
			const commitData = await commitRes.json() as { tree: { sha: string } };
			let treeSha = commitData.tree.sha;

			// Step 3: Walk the tree along each path segment
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

				const entry = treeData.tree.find(
					(e) => e.path === segment && e.type === "tree"
				);
				if (!entry) {
					return c.json({ error: `Directory not found: ${segment}` }, { status: 404 });
				}
				treeSha = entry.sha;
			}

			// Step 4: Fetch the target directory tree and collect blob (file) paths
			const finalTreeRes = await fetch(
				`${base}/git/trees/${treeSha}`,
				{ headers: githubHeaders }
			);
			if (!finalTreeRes.ok) {
				console.error(`Failed to fetch target tree: ${finalTreeRes.status} ${finalTreeRes.statusText}`);
				return c.json({ error: "Failed to fetch target directory tree" }, { status: 500 });
			}
			const finalTreeData = await finalTreeRes.json() as {
				tree: Array<{ path: string; type: string; sha: string }>;
			};

			const dirPrefix = segments.length > 0 ? segments.join("/") + "/" : "";
			const filePaths = finalTreeData.tree
				.filter((e) => e.type === "blob")
				.map((e) => `${dirPrefix}${e.path}`);

			return c.json({ filePaths });
		} catch (error) {
			console.error("Error fetching directory:", error);
			return c.json({ error: "Internal server error" }, { status: 500 });
		}
	}
}
