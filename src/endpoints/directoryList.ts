import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { verify } from "hono/jwt";

const DirectoryListResponse = z.object({
	filePaths: z.array(Str({ description: "File name within the directory" })),
});

export class DirectoryList extends OpenAPIRoute {
	schema = {
		tags: ["Admin"],
		summary: "List files in a directory by its tree SHA",
		request: {
			params: z.object({
				sha: Str({ description: "Git tree SHA of the target directory" }),
			}),
			headers: z.object({
				authorization: Str({ example: "Bearer <jwt_token>" }),
			}),
		},
		responses: {
			"200": {
				description: "Directory contents fetched successfully",
				content: {
					"application/json": {
						schema: DirectoryListResponse,
					},
				},
			},
			"401": { description: "Unauthorized - invalid or missing JWT" },
			"404": { description: "Tree SHA not found" },
			"500": { description: "Error fetching tree from GitHub" },
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

		const sha = c.req.param("sha");
		if (!sha) {
			return c.json({ error: "Tree SHA is required" }, { status: 400 });
		}

		const githubHeaders = {
			Authorization: `Bearer ${c.env.GITHUB_PAT}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "purpl-cms-worker",
		};
		const base = `https://api.github.com/repos/${c.env.GITHUB_OWNER}/${c.env.GITHUB_REPO}`;

		try {
			const treeRes = await fetch(
				`${base}/git/trees/${sha}`,
				{ headers: githubHeaders }
			);
			if (treeRes.status === 404) {
				return c.json({ error: "Tree SHA not found" }, { status: 404 });
			}
			if (!treeRes.ok) {
				console.error(`Failed to fetch tree: ${treeRes.status} ${treeRes.statusText}`);
				return c.json({ error: "Failed to fetch tree" }, { status: 500 });
			}

			const treeData = await treeRes.json() as {
				tree: Array<{ path: string; type: string }>;
			};
			const filePaths = treeData.tree
				.filter((e) => e.type === "blob")
				.map((e) => e.path);

			return c.json({ filePaths });
		} catch (error) {
			console.error("Error listing directory:", error);
			return c.json({ error: "Internal server error" }, { status: 500 });
		}
	}
}
