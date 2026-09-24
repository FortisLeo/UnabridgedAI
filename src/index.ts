import { createServer } from "node:http";
import { createApp, errorHandler } from "./app.ts";
import { closeDb } from "./db/client.ts";
import { env, isProduction } from "./lib/env.ts";
import { attachUi } from "./ui.ts";

const app = createApp();
const server = createServer(app);
const closeUi = await attachUi(app, server);
app.use(errorHandler);

server.listen(env.port, () => {
  const mode = isProduction ? "UI" : "Vite HMR";
  console.log(`UnabridgedAI listening on http://localhost:${env.port} (${mode})`);
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  Promise.resolve(closeUi?.())
    .catch(() => undefined)
    .finally(() => {
      server.close(() => {
        closeDb();
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 1000).unref();
    });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
