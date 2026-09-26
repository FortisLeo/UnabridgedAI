import { createHash, createHmac } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

const HARDENED = 0x80000000;
const XPUB_VERSION = 0x0488b21e;

export class XpubError extends Error {}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();
const hash160 = (data: Uint8Array) => createHash("ripemd160").update(sha256(data)).digest();

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const decodeBase58 = (value: string) => {
  let num = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new XpubError("Invalid xpub");
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
  return Uint8Array.from(bytes.reverse());
};

const readU32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);

export type ExtendedKey = { key: Uint8Array; chainCode: Uint8Array };

export const parseAccountXpub = (xpub: string): ExtendedKey => {
  const raw = decodeBase58(xpub.trim());
  if (raw.length !== 82) throw new XpubError("Invalid xpub");
  const payload = raw.subarray(0, 78);
  const checksum = raw.subarray(78);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  if (!checksum.every((byte, index) => byte === expected[index])) throw new XpubError("Invalid xpub checksum");
  const version = readU32(payload, 0);
  if (version !== XPUB_VERSION) throw new XpubError("Expected an account xpub");
  const depth = payload[4] ?? 0;
  if (depth !== 3) throw new XpubError("Expected the account xpub at m/44'/60'/0'");
  return { key: payload.subarray(45, 78), chainCode: payload.subarray(13, 45) };
};

const ser32 = (index: number) => {
  const out = new Uint8Array(4);
  out[0] = (index >>> 24) & 0xff;
  out[1] = (index >>> 16) & 0xff;
  out[2] = (index >>> 8) & 0xff;
  out[3] = index & 0xff;
  return out;
};

const pointAdd = (left: Uint8Array, right: Uint8Array) => {
  const point = secp256k1.ProjectivePoint.fromHex(left).add(secp256k1.ProjectivePoint.fromHex(right));
  return point.toRawBytes(true);
};

const deriveChild = (parent: ExtendedKey, index: number): ExtendedKey => {
  if (index >= HARDENED) throw new XpubError("Cannot derive a hardened child from an xpub");
  const data = new Uint8Array(37);
  data.set(parent.key, 0);
  data.set(ser32(index), 33);
  const digest = createHmac("sha512", parent.chainCode).update(data).digest();
  const il = digest.subarray(0, 32);
  const ir = digest.subarray(32);
  const tweak = secp256k1.utils.normPrivateKeyToScalar(il);
  const child = secp256k1.getPublicKey(tweak, true);
  return { key: pointAdd(parent.key, child), chainCode: new Uint8Array(ir) };
};

const toChecksumAddress = (bytes: Uint8Array) => {
  const hex = Buffer.from(bytes).toString("hex");
  const hash = Buffer.from(keccak_256(Buffer.from(hex))).toString("hex");
  let out = "0x";
  for (let i = 0; i < hex.length; i += 1) {
    const char = hex[i] ?? "";
    out += Number.parseInt(hash[i] ?? "0", 16) >= 8 ? char.toUpperCase() : char;
  }
  return out;
};

export const deriveEvmAddress = (xpub: string, index: number) => {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new XpubError("Invalid derivation index");
  const account = parseAccountXpub(xpub);
  const external = deriveChild(account, 0);
  const child = deriveChild(external, index);
  const uncompressed = secp256k1.ProjectivePoint.fromHex(child.key).toRawBytes(false).subarray(1);
  const hash = keccak_256(uncompressed);
  return toChecksumAddress(hash.subarray(12));
};

export const padTopicAddress = (address: string) => `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
