import express from "express";
import type { Server } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { env, isProduction } from "./lib/env.ts";

export const attachUi = async (app: express.Express, server: Server) => {
  if (!isProduction) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: env.webRoot,
      configFile: join(env.root, "vite.config.ts"),
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
    return vite.close.bind(vite);
  }

  if (!existsSync(env.webDist)) {
    console.warn("dist/ not found. Run `npm run build` to serve the UI from this process.");
    return;
  }

  const assets = join(env.webDist, "assets");
  if (existsSync(assets)) {
    app.use("/assets", express.static(assets, { maxAge: "1y", immutable: true, index: false }));
  }
  app.use(express.static(env.webDist, { index: false, maxAge: 0 }));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(env.webDist, "index.html"), (error) => error && next(error));
  });
};
