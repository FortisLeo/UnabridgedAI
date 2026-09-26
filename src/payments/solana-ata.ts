import { createHash } from "node:crypto";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./allowlist.ts";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const decodeBase58 = (value: string) => {
  let num = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("Invalid base58");
    num = num * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.push(Number(num & 0xffn));
    num >>= 8n;
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.push(0);
  }
  const decoded = bytes.reverse();
  if (decoded.length > 32) throw new Error("Invalid public key");
  return Uint8Array.from([...new Array(32 - decoded.length).fill(0), ...decoded]);
};

export const encodeBase58 = (bytes: Uint8Array) => {
  let num = 0n;
  for (const byte of bytes) num = (num << 8n) + BigInt(byte);
  let out = "";
  while (num > 0n) {
    const digit = Number(num % 58n);
    num /= 58n;
    out = alphabet[digit] + out;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out || "1";
};

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();

const findProgramAddress = (seeds: Uint8Array[], program: Uint8Array) => {
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = sha256(Buffer.concat([...seeds, Buffer.from([bump]), program, Buffer.from("ProgramDerivedAddress")]));
    try {
      if (isOnCurve(hash)) continue;
    } catch {
      continue;
    }
    return encodeBase58(hash);
  }
  throw new Error("Could not derive associated token account");
};

const isOnCurve = (bytes: Uint8Array) => {
  const p = (1n << 255n) - 19n;
  const d = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
  let y = 0n;
  for (let i = 0; i < 32; i += 1) y += BigInt(bytes[i] ?? 0) << (8n * BigInt(i));
  y &= (1n << 255n) - 1n;
  const y2 = (y * y) % p;
  const u = (y2 - 1n + p) % p;
  const v = (d * y2 + 1n) % p;
  const x2 = (u * modPow(v, p - 2n, p)) % p;
  if (x2 === 0n) return y === 1n ? false : (bytes[31] ?? 0) >> 7 === 1;
  const x = modPow(x2, (p + 3n) / 8n, p);
  const check = (x * x) % p === x2 ? x : (x * modPow(2n, (p - 1n) / 4n, p)) % p;
  return (check * check) % p === x2;
};

const modPow = (base: bigint, exp: bigint, mod: bigint) => {
  let result = 1n;
  let value = base % mod;
  let exponent = exp;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * value) % mod;
    value = (value * value) % mod;
    exponent >>= 1n;
  }
  return result;
};

export const associatedTokenAddress = (owner: string, mint: string) =>
  findProgramAddress(
    [decodeBase58(owner), decodeBase58(TOKEN_PROGRAM_ID), decodeBase58(mint)],
    decodeBase58(ASSOCIATED_TOKEN_PROGRAM_ID),
  );

export const isSolanaAddress = (value: string) => {
  try {
    return decodeBase58(value).length === 32 && value.length >= 32 && value.length <= 44;
  } catch {
    return false;
  }
};
