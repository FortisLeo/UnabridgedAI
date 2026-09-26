import type { Request } from "express";

const privateRange = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1$|fc[0-9a-f]|fd[0-9a-f]|localhost$)/i;

const hopCount = () => {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
};

/** Trust only an explicit hop count. The default deploy has no proxy, so the socket address wins. */
export const trustProxySetting = (): number => hopCount();

const normalize = (value: string) => value.replace(/^::ffff:/i, "").trim();

/**
 * Address Express already validated. Never read X-Forwarded-For ourselves:
 * with trust proxy off, req.ip is the socket peer; with a configured hop count,
 * Express uses the hop the proxy appended, not the caller-supplied first value.
 */
export const clientIp = (req: Request) => normalize(req.ip || req.socket.remoteAddress || "") || "unknown";

export const isPrivateIp = (ip: string) => privateRange.test(normalize(ip));
