import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import next from "next";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { createRuntime } from "./runtime.js";
import { createHttpHandler } from "./http-handler.js";

const runtime = await createRuntime();
const port = Number(process.env.PORT || 3000);
let handlePages;
const server = createServer(
  createHttpHandler(
    createApp(runtime.db, { notify: runtime.notify }),
    (req, res) => handlePages(req, res),
  ),
);
const web = next({
  dev: false,
  dir: fileURLToPath(new URL("../../frontend/", import.meta.url)),
  hostname: config.host,
  port,
  httpServer: server,
});
try {
  await web.prepare();
  handlePages = web.getRequestHandler();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, config.host, resolve);
  });
} catch (error) {
  await web.close();
  await runtime.close();
  throw error;
}
console.log(`Santa Social website and API listening on port ${port}`);
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    try {
      await web.close();
      await runtime.close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
