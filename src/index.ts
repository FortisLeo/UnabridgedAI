import { createServer } from "node:http";
import { createApp, errorHandler } from "./app.ts";
import { closeDb } from "./db/client.ts";
import { env, isProduction } from "./lib/env.ts";
import { startPaymentWatchers, stopPaymentWatchers } from "./payments/watch.ts";
import { attachUi } from "./ui.ts";

const app = createApp();
app.use(errorHandler);
const server = createServer(app);
const closeUi = await attachUi(app, server);

server.listen(env.port, () => {
  const mode = isProduction ? "UI" : "Vite HMR";
  console.log(`UnabridgedAI listening on http://localhost:${env.port} (${mode})`);
  startPaymentWatchers();
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  Promise.resolve(closeUi?.())
    .catch(() => undefined)
    .finally(() => {
      void stopPaymentWatchers().finally(() => {
        server.close(() => {
          closeDb();
          process.exit(0);
        });
        setTimeout(() => process.exit(0), 5000).unref();
      });
    });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
