import { DateTime, Str } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";

export type Bindings = {
	KV: KVNamespace,
	JWT_SECRET: string,
	GITHUB_PAT: string,
	GITHUB_OWNER: string,
	GITHUB_REPO: string,
	GITHUB_BASE_BRANCH: string,
	ALLOWED_ORIGIN: string
}

export type AppContext = Context<{ Bindings: Bindings }>;

export const Task = z.object({
	name: Str({ example: "lorem" }),
	slug: Str(),
	description: Str({ required: false }),
	completed: z.boolean().default(false),
	due_date: DateTime(),
});
