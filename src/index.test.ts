import { describe, it, expect, vi, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import app from "./index";

// ---------------------------------------------------------------------------
// Mock environment
// ---------------------------------------------------------------------------

const TEST_USERNAME = "testadmin";
const TEST_PASSWORD = "testpassword";
const JWT_SECRET = "test-jwt-secret";

let mockEnv: Record<string, unknown>;

beforeAll(async () => {
	const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

	mockEnv = {
		JWT_SECRET,
		GITHUB_PAT: "mock-pat",
		GITHUB_OWNER: "mock-owner",
		GITHUB_REPO: "mock-repo",
		GITHUB_TARGET_BRANCH: "master",
		GITHUB_BASE_BRANCH: "main",
		ALLOWED_ORIGIN: "*",
		KV: {
			get: vi.fn(async (key: string) => {
				if (key === "ADMIN_USERNAME") return TEST_USERNAME;
				if (key === "ADMIN_PASSWORD") return passwordHash;
				return null;
			}),
			put: vi.fn(),
		},
	};
});

// ---------------------------------------------------------------------------
// GitHub API mock
//
// Simulates the tree structure:
//   root/
//     src/           (sha: mock-src-sha)
//       json/        (sha: mock-json-sha)
//         press.json (sha: mock-press-sha)
//         news.json  (sha: mock-news-sha)
// ---------------------------------------------------------------------------

vi.stubGlobal(
	"fetch",
	async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
		const base = "https://api.github.com/repos/mock-owner/mock-repo";

		// GET routes
		if (url === `${base}/git/refs/heads/master`) {
			return Response.json({ object: { sha: "mock-commit-sha" } });
		}
		if (url === `${base}/git/commits/mock-commit-sha`) {
			return Response.json({ tree: { sha: "mock-root-sha" } });
		}
		if (url === `${base}/git/trees/mock-root-sha`) {
			return Response.json({
				tree: [{ path: "src", type: "tree", sha: "mock-src-sha" }],
			});
		}
		if (url === `${base}/git/trees/mock-src-sha`) {
			return Response.json({
				tree: [{ path: "json", type: "tree", sha: "mock-json-sha" }],
			});
		}
		if (url === `${base}/git/trees/mock-json-sha`) {
			return Response.json({
				tree: [
					{ path: "press.json", type: "blob", sha: "mock-press-sha" },
					{ path: "news.json", type: "blob", sha: "mock-news-sha" },
				],
			});
		}
		if (url === `${base}/git/trees/mock-json-sha?recursive=1`) {
			return Response.json({
				tree: [
					{ path: "press.json", type: "blob", sha: "mock-press-sha", size: 42 },
					{ path: "news.json", type: "blob", sha: "mock-news-sha", size: 55 },
				],
				truncated: false,
			});
		}
		if (url === `${base}/contents/src/json/press.json`) {
			return Response.json({
				content: btoa(JSON.stringify({ title: "Mock Press Release" })),
				sha: "mock-press-sha",
			});
		}

		// POST routes (PR creation flow)
		if (method === "POST") {
			if (url === `${base}/git/trees`) {
				return Response.json({ sha: "mock-new-tree-sha" });
			}
			if (url === `${base}/git/commits`) {
				return Response.json({ sha: "mock-new-commit-sha" });
			}
			if (url === `${base}/git/refs`) {
				return Response.json({ ref: "refs/heads/admin/update-mock", object: { sha: "mock-new-commit-sha" } });
			}
			if (url === `${base}/pulls`) {
				return Response.json({ html_url: "https://github.com/mock-owner/mock-repo/pull/1" });
			}
		}

		return new Response(JSON.stringify({ error: `Unexpected fetch: ${method} ${url}` }), {
			status: 500,
		});
	}
);

// ---------------------------------------------------------------------------
// Helper to call the app with the mock environment
// ---------------------------------------------------------------------------

function request(path: string, init?: RequestInit): Promise<Response> {
	return app.fetch(new Request(`http://localhost${path}`, init), mockEnv);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/login with incorrect credentials", () => {
	it("rejects a wrong password", async () => {
		const res = await request("/api/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: TEST_USERNAME, password: "wrongpassword" }),
		});

		expect(res.status).toBe(401);
		const body = await res.json() as { error: string };
		expect(body.error).toBe("Invalid credentials");
	});

	it("rejects a wrong username", async () => {
		const res = await request("/api/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "wronguser", password: TEST_PASSWORD }),
		});

		expect(res.status).toBe(401);
		const body = await res.json() as { error: string };
		expect(body.error).toBe("Invalid credentials");
	});
});

describe("CMS API flow: login → directory → directory-list → file", () => {
	let token: string;

	it("POST /api/login returns a JWT token", async () => {
		const res = await request("/api/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
		});

		expect(res.status).toBe(200);
		const body = await res.json() as { token: string; expiresIn: number };
		expect(body.token).toBeTruthy();
		expect(body.expiresIn).toBe(86400);
		token = body.token;
	});

	it("GET /api/directory/:dir returns a nested tree for src/json", async () => {
		const res = await request("/api/directory/src%2Fjson", {
			headers: { authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(200);
		const body = await res.json() as { tree: Record<string, unknown>; truncated: boolean };
		expect(body.truncated).toBe(false);
		expect(body.tree).toMatchObject({
			"press.json": { type: "blob", sha: "mock-press-sha", size: 42 },
			"news.json": { type: "blob", sha: "mock-news-sha", size: 55 },
		});
	});

	it("GET /api/directory-list/:sha returns files in the directory", async () => {
		const res = await request("/api/directory-list/mock-json-sha", {
			headers: { authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(200);
		const body = await res.json() as { filePaths: string[] };
		expect(body.filePaths).toEqual(["press.json", "news.json"]);
	});

	it("GET /api/files/:filePath returns content of a file in src/json", async () => {
		const res = await request("/api/files/src%2Fjson%2Fpress.json", {
			headers: { authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(200);
		const body = await res.json() as { content: string; sha: string };
		expect(body.sha).toBe("mock-press-sha");
		expect(body.content).toBeTruthy();
	});
});

describe("POST /api/pr", () => {
	let token: string;

	beforeAll(async () => {
		const res = await request("/api/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
		});
		const body = await res.json() as { token: string };
		token = body.token;
	});

	const validPayload = () => ({
		title: "Update press.json",
		description: "Added new press article",
		files: [
			{
				path: "src/json/press.json",
				content: btoa(JSON.stringify({ title: "New Press Release" })),
				sha: "mock-press-sha",
			},
		],
	});

	it("returns 401 without a token", async () => {
		const res = await request("/api/pr", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validPayload()),
		});

		expect(res.status).toBe(401);
	});

	it("returns 400 with a missing required field", async () => {
		const res = await request("/api/pr", {
			method: "POST",
			headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
			body: JSON.stringify({ files: validPayload().files }), // missing title
		});

		expect(res.status).toBe(400);
	});

	it("returns 409 when a file SHA is stale", async () => {
		const res = await request("/api/pr", {
			method: "POST",
			headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
			body: JSON.stringify({
				...validPayload(),
				files: [{ ...validPayload().files[0], sha: "outdated-sha" }],
			}),
		});

		expect(res.status).toBe(409);
		const body = await res.json() as { error: string };
		expect(body.error).toMatch(/modified since it was loaded/);
	});

	it("creates a PR and returns prUrl and branch", async () => {
		const res = await request("/api/pr", {
			method: "POST",
			headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
			body: JSON.stringify(validPayload()),
		});

		expect(res.status).toBe(200);
		const body = await res.json() as { prUrl: string; branch: string };
		expect(body.prUrl).toBe("https://github.com/mock-owner/mock-repo/pull/1");
		expect(body.branch).toMatch(/^admin\/update-\d+$/);
	});
});
