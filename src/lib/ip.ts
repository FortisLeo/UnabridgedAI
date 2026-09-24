import type { Request } from "express";

const privateRange = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1|fc|fd|localhost)/i;

export const clientIp = (req: Request) => {
  const forwarded = req.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || req.ip || req.socket.remoteAddress || "";
  return raw.replace(/^::ffff:/, "") || "unknown";
};

export const isPrivateIp = (ip: string) => privateRange.test(ip);
