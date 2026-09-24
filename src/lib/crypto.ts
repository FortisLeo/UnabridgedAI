import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export const passwordHash = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

export const passwordOk = (password: string, stored: string) => {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export const randomToken = () => randomBytes(32).toString("base64url");
export const makeApiKey = () => `UnabridgedAI_${randomToken()}`;
export { randomUUID };
