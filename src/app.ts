import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { auth } from "./middleware/auth.ts";
import { blockBlacklistedIp } from "./middleware/security.ts";
import { authRouter } from "./routes/auth.ts";
import { billingRouter } from "./routes/billing.ts";
import { chatRouter } from "./routes/chat.ts";
import { chatsRouter } from "./routes/chats.ts";
import { dataRouter } from "./routes/data.ts";
import { keysRouter } from "./routes/keys.ts";
import { meRouter } from "./routes/me.ts";
import { settingsRouter } from "./routes/settings.ts";

export const createApp = () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false, hsts: false }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", blockBlacklistedIp);

  app.use("/api/auth", authRouter);
  app.use("/api/me", auth, meRouter);
  app.use("/api/chats", auth, chatsRouter);
  app.use("/api/chat", auth, chatRouter);
  app.use("/api/settings", auth, settingsRouter);
  app.use("/api/data", auth, dataRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/keys", auth, keysRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
};

export const errorHandler = (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error instanceof Error ? error.message : "Something went wrong" });
};
