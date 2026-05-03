import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { AdminLogin } from "./endpoints/adminLogin";
import { FileFetch } from "./endpoints/fileFetch";
import { DirectoryFetch } from "./endpoints/directoryFetch";
import { PRCreate } from "./endpoints/prCreate";
import { Bindings } from "./types";

// Start a Hono app
const app = new Hono<{ Bindings: Bindings }>();

// CORS — created per-request so c.env.ALLOWED_ORIGIN is available at runtime
app.use("/api/*", (c, next) =>
	cors({
		origin: c.env.ALLOWED_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		maxAge: 86400,
	})(c, next)
);

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Register OpenAPI endpoints
openapi.post("/api/login", AdminLogin);
openapi.get("/api/files/:filePath", FileFetch);
openapi.get("/api/directory/:dir", DirectoryFetch);
openapi.post("/api/pr", PRCreate);

// You may also register routes for non OpenAPI directly on Hono
// app.get('/test', (c) => c.text('Hono!'))

// Export the Hono app
export default app;
