import { OpenAPIRoute, Str } from "chanfana";
import type { AppContext } from "../types";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { sign } from "hono/jwt";

// Request schema
const LoginRequest = z.object({
	username: Str({ example: "your-admin-username" }),
	password: Str({ example: "your admin password" }),
});

// Response schema
const LoginResponse = z.object({
	token: Str({ description: "JWT token valid for 24 hours" }),
	expiresIn: z.number({ description: "Token expiry in seconds" }),
});

export class AdminLogin extends OpenAPIRoute {
	schema = {
		tags: ["Admin"],
		summary: "Login with admin credentials",
		request: {
			body: {
				content: {
					"application/json": {
						schema: LoginRequest,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Login successful",
				content: {
					"application/json": {
						schema: LoginResponse,
					},
				},
			},
			"401": {
				description: "Invalid credentials",
			},
		},
	};

	async handle(c: AppContext) {
		const body = await c.req.json();

		// Validate request body
		const result = LoginRequest.safeParse(body);
		if (!result.success) {
			return c.json(
				{ error: "Invalid request body" },
				{
					status: 400,
				}
			);
		}

		const { username, password } = result.data;

		// Validate username
        const kvUsername = await c.env.KV.get("ADMIN_USERNAME");
		if (username !== kvUsername) {
			return c.json(
				{ error: "Invalid credentials" },
				{
					status: 401,
				}
			);
		}

		// Validate password using bcrypt
        const kvPasswordHash = await c.env.KV.get("ADMIN_PASSWORD");
		const passwordMatch = await bcrypt.compare(password, kvPasswordHash);
		if (!passwordMatch) {
			return c.json(
				{ error: "Invalid credentials" },
				{
					status: 401,
				}
			);
		}

		// Generate JWT token (24 hour expiry)
		const expiresIn = 24 * 60 * 60; // 24 hours in seconds
		const token = await sign(
			{
				username,
				iat: Math.floor(Date.now() / 1000),
				exp: Math.floor(Date.now() / 1000) + expiresIn,
			},
			c.env.JWT_SECRET
		);

		return c.json({
			token,
			expiresIn,
		});
	}
}
