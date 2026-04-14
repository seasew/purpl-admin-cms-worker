import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { verify } from "hono/jwt";

const DirectoryFetchResponse = z.object({
	sha: Str({ description: "SHA of the target directory tree" }),
});

export class DirectoryFetch extends OpenAPIRoute {
	schema = {
		tags: ["Admin"],
		summary: "Get the SHA of a repository directory",
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
				description: "Directory SHA fetched successfully",
				content: {
					"application/json": {
						schema: DirectoryFetchResponse,
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

			// Walk the tree along each path segment
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

			return c.json({ sha: treeSha });
		} catch (error) {
			console.error("Error fetching directory:", error);
			return c.json({ error: "Internal server error" }, { status: 500 });
		}
	}
}
