import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { db } from "./db/client.ts";
import { publicError } from "./lib/errors.ts";
import { trustProxySetting } from "./lib/ip.ts";
import { apiKeyAuth, auth } from "./middleware/auth.ts";
import { blockBlacklistedIp } from "./middleware/security.ts";
import { authRouter } from "./routes/auth.ts";
import { adminRouter } from "./routes/admin.ts";
import { billingRouter } from "./routes/billing.ts";
import { chatRouter } from "./routes/chat.ts";
import { chatsRouter } from "./routes/chats.ts";
import { dataRouter } from "./routes/data.ts";
import { keysRouter } from "./routes/keys.ts";
import { meRouter } from "./routes/me.ts";
import { openaiRouter } from "./routes/openai.ts";
import { settingsRouter } from "./routes/settings.ts";

const corsV1 = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, x-api-key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
};

export const createApp = () => {
  const app = express();
  app.set("trust proxy", trustProxySetting());
  app.use(helmet({ contentSecurityPolicy: false, hsts: false, crossOriginResourcePolicy: false, crossOriginOpenerPolicy: false }));
  app.use(express.json({ limit: "2mb" }));
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error && typeof error === "object" && "type" in error && (error as { type?: string }).type === "entity.parse.failed") {
      return res.status(400).json({ error: "Invalid JSON" });
    }
    next(error);
  });
  app.use(cookieParser());
  app.get("/api/health", (_req, res) => {
    try {
      db.prepare("SELECT 1 AS ok").get();
      res.json({ ok: true, db: true });
    } catch {
      res.status(503).json({ ok: false, db: false });
    }
  });
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", blockBlacklistedIp);

  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/me", auth, meRouter);
  app.use("/api/chats", auth, chatsRouter);
  app.use("/api/chat", auth, chatRouter);
  app.use("/api/settings", auth, settingsRouter);
  app.use("/api/data", auth, dataRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/keys", auth, keysRouter);
  app.use("/v1", corsV1, blockBlacklistedIp, apiKeyAuth, openaiRouter);
  app.use("/api/v1", corsV1, blockBlacklistedIp, apiKeyAuth, openaiRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  return app;
};

export const errorHandler = (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
  const code = status >= 400 && status < 600 ? status : 500;
  res.status(code).json({ error: publicError(code) });
};
