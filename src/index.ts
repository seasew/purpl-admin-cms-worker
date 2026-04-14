import { fromHono } from "chanfana";
import { Hono } from "hono";
import { TaskCreate } from "./endpoints/taskCreate";
import { TaskDelete } from "./endpoints/taskDelete";
import { TaskFetch } from "./endpoints/taskFetch";
import { TaskList } from "./endpoints/taskList";

import { AdminLogin } from "./endpoints/adminLogin";
import { FileFetch } from "./endpoints/fileFetch";
import { DirectoryFetch } from "./endpoints/directoryFetch";
import { DirectoryList } from "./endpoints/directoryList";
import { Bindings } from "./types";

// Start a Hono app
const app = new Hono<{ Bindings: Bindings }>();

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Register OpenAPI endpoints
openapi.get("/api/tasks", TaskList);
openapi.post("/api/tasks", TaskCreate);
openapi.get("/api/tasks/:taskSlug", TaskFetch);
openapi.delete("/api/tasks/:taskSlug", TaskDelete);

openapi.post("/api/login", AdminLogin);
openapi.get("/api/files/:filePath", FileFetch);
openapi.get("/api/directory/:dir", DirectoryFetch);
openapi.get("/api/directory-list/:sha", DirectoryList);

// You may also register routes for non OpenAPI directly on Hono
// app.get('/test', (c) => c.text('Hono!'))

// Export the Hono app
export default app;
