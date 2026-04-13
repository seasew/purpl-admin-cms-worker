import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { verify } from "hono/jwt";

const FileResponse = z.object({
	content: Str({ description: "File content (base64 encoded by GitHub API)" }),
	sha: Str({ description: "File SHA hash" }),
});

export class FileFetch extends OpenAPIRoute {
	schema = {
		tags: ["Admin"],
		summary: "Fetch a file from the repository",
		request: {
			params: z.object({
				filePath: Str({ description: "File path relative to repo root (e.g., src/json/press.js)" }),
			}),
			headers: z.object({
				authorization: Str({ example: "Bearer <jwt_token>" }),
			}),
		},
		responses: {
			"200": {
				description: "File fetched successfully",
				content: {
					"application/json": {
						schema: FileResponse,
					},
				},
			},
			"401": {
				description: "Unauthorized - invalid or missing JWT",
			},
			"404": {
				description: "File not found",
			},
			"500": {
				description: "Error fetching file from GitHub",
			},
		},
	};

	async handle(c: AppContext) {
		// Validate JWT from Authorization header
		const authHeader = c.req.header("authorization");
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return c.json({ error: "Missing or invalid authorization header" }, { status: 401 });
		}

		const token = authHeader.slice(7); // Remove "Bearer " prefix
		try {
			await verify(token, c.env.JWT_SECRET, 'HS256');
		} catch (e) {
			return c.json({ error: "Invalid token" }, { status: 401 });
		}

		// Get the file path from URL parameter
		const filePath = c.req.param("filePath");
		if (!filePath) {
			return c.json({ error: "File path is required" }, { status: 400 });
		}

		try {
			console.log(c.env.GITHUB_PAT);
			console.log(c.env.GITHUB_OWNER);
			console.log(c.env.GITHUB_REPO);
			// Call GitHub API to get file content
			// https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28#get-repository-content
			const response = await fetch(
				`https://api.github.com/repos/${c.env.GITHUB_OWNER}/${c.env.GITHUB_REPO}/contents/${filePath}`,
				{
					method: "GET",
					headers: {
						Authorization: `Bearer ${c.env.GITHUB_PAT}`,
						Accept: "application/vnd.github+json",
						"X-GitHub-Api-Version": "2026-03-10",
						"User-Agent": "purpl-cms-worker",
					},
				}
			);

			if (response.status === 404) {
				return c.json({ error: "File not found" }, { status: 404 });
			}

			if (!response.ok) {
				console.error(`GitHub API error: ${response.status} ${response.statusText}`);
				return c.json(
					{ error: `Failed to fetch file: ${response.statusText}` },
					{ status: response.status as ContentfulStatusCode }
				);
			}

			const fileData = await response.json() as {
				content: string;
				sha: string;
				name?: string;
				path?: string;
			};

			return c.json({
				content: fileData.content,
				sha: fileData.sha,
			});
		} catch (error) {
			console.error("Error fetching file:", error);
			return c.json(
				{ error: "Internal server error" },
				{ status: 500 }
			);
		}
	}
}
