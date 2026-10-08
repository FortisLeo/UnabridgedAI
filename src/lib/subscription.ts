export const SUBSCRIPTION_MS = 28 * 24 * 60 * 60 * 1000;

export const proActive = (plan: string, expiresAt: number | null | undefined, now = Date.now()) =>
  plan === "pro" && expiresAt != null && expiresAt > now;

export const nextProExpiry = (current: number | null | undefined, now = Date.now()) =>
  Math.max(current ?? 0, now) + SUBSCRIPTION_MS;
