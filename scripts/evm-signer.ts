import { createServer, type IncomingMessage } from "node:http";
import { createHmac, createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { mod } from "@noble/curves/abstract/modular";
import { keccak_256 } from "@noble/hashes/sha3";

const HARDENED = 0x80000000;
const XPRV_VERSION = 0x0488ade4;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const decodeBase58 = (value: string) => {
  let num = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("Invalid xprv");
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

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();

type ExtendedKey = { key: Uint8Array; chainCode: Uint8Array };

export const parseAccountXprv = (xprv: string): ExtendedKey => {
  const raw = decodeBase58(xprv.trim());
  if (raw.length !== 82) throw new Error("Invalid xprv");
  const payload = raw.subarray(0, 78);
  const checksum = raw.subarray(78);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  if (!checksum.every((byte, index) => byte === expected[index])) throw new Error("Invalid xprv checksum");
  if (readU32(payload, 0) !== XPRV_VERSION) throw new Error("Expected an account xprv");
  if ((payload[4] ?? 0) !== 3) throw new Error("Expected the account xprv at m/44'/60'/0'");
  if (payload[45] !== 0) throw new Error("Invalid xprv key padding");
  return { key: payload.subarray(46, 78), chainCode: payload.subarray(13, 45) };
};

const ser32 = (index: number) => Uint8Array.of((index >>> 24) & 0xff, (index >>> 16) & 0xff, (index >>> 8) & 0xff, index & 0xff);

const deriveChild = (parent: ExtendedKey, index: number): ExtendedKey => {
  const hardened = index >= HARDENED;
  const data = hardened ? new Uint8Array(37) : new Uint8Array(37);
  if (hardened) {
    data[0] = 0;
    data.set(parent.key, 1);
  } else {
    data.set(secp256k1.getPublicKey(parent.key, true), 0);
  }
  data.set(ser32(index), 33);
  const digest = createHmac("sha512", parent.chainCode).update(data).digest();
  const il = digest.subarray(0, 32);
  const child = mod(bytesToBigInt(il) + bytesToBigInt(parent.key), secp256k1.CURVE.n);
  if (child === 0n) throw new Error("Invalid derived key");
  return { key: bigIntToBytes(child), chainCode: new Uint8Array(digest.subarray(32)) };
};

const bytesToBigInt = (bytes: Uint8Array) => BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
const bigIntToBytes = (value: bigint) => {
  const hex = value.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
};

export const deriveDepositKey = (account: ExtendedKey, index: number) => {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new Error("Invalid derivation index");
  return deriveChild(deriveChild(account, 0), index).key;
};

export const addressOf = (privateKey: Uint8Array) => {
  const uncompressed = secp256k1.ProjectivePoint.fromHex(secp256k1.getPublicKey(privateKey, true)).toRawBytes(false).subarray(1);
  return `0x${Buffer.from(keccak_256(uncompressed).subarray(12)).toString("hex")}`;
};

const rlpLength = (offset: number, length: number) => {
  if (length < 56) return Uint8Array.of(offset + length);
  const size = bigIntToBytes(BigInt(length));
  return concat([Uint8Array.of(offset + 55 + size.length), size]);
};
const rlpString = (bytes: Uint8Array): Uint8Array =>
  bytes.length === 1 && bytes[0]! < 0x80 ? bytes : concat([rlpLength(0x80, bytes.length), bytes]);
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const readLength = (bytes: Uint8Array, offset: number, first: number, base: number) => {
  if (first < base + 56) return { start: offset + 1, length: first - base };
  const sizeLength = first - (base + 55);
  if (sizeLength > 4) throw new Error("RLP length is too large");
  let length = 0;
  for (let index = 0; index < sizeLength; index += 1) length = (length << 8) + (bytes[offset + 1 + index] ?? 0);
  return { start: offset + 1 + sizeLength, length };
};
const decodeRlpList = (bytes: Uint8Array) => {
  if ((bytes[0] ?? 0) < 0xc0) throw new Error("Expected an RLP list");
  const [payload] = readItem(bytes, 0);
  const items: Uint8Array[] = [];
  let offset = 0;
  while (offset < payload.length) {
    const [item, next] = readItem(payload, offset);
    items.push(item);
    offset = next;
  }
  if (items.length !== 9) throw new Error("Expected an unsigned legacy transaction");
  return items;
};
const readItem = (bytes: Uint8Array, offset: number): [Uint8Array, number] => {
  const first = bytes[offset] ?? 0;
  if (first < 0x80) return [bytes.subarray(offset, offset + 1), offset + 1];
  const base = first < 0xc0 ? 0x80 : 0xc0;
  const { start, length } = readLength(bytes, offset, first, base);
  return [bytes.subarray(start, start + length), start + length];
};

const quantity = (bytes: Uint8Array) => (bytes.length === 0 ? 0n : bytesToBigInt(bytes));

export const signSweep = (account: ExtendedKey, request: { unsignedTx: string; fromAddress: string; derivationIndex: number; chainId: number }) => {
  if (!/^0x[0-9a-fA-F]+$/.test(request.unsignedTx)) throw new Error("unsignedTx must be hex");
  const items = decodeRlpList(Uint8Array.from(Buffer.from(request.unsignedTx.slice(2), "hex")));
  const chainId = quantity(items[6]!);
  if (chainId !== 137n && chainId !== 1n) throw new Error("Refusing a chain other than Polygon or Ethereum");
  if (BigInt(request.chainId) !== chainId) throw new Error("Chain id does not match the transaction");
  if (quantity(items[4]!) !== 0n) throw new Error("Refusing a transaction that sends native currency");
  const key = deriveDepositKey(account, request.derivationIndex);
  if (addressOf(key).toLowerCase() !== request.fromAddress.toLowerCase()) throw new Error("Derived address does not match the paid address");
  const hash = keccak_256(Uint8Array.from(Buffer.from(request.unsignedTx.slice(2), "hex")));
  const signature = secp256k1.sign(hash, key);
  const recovery = signature.recovery;
  const v = chainId * 2n + 35n + BigInt(recovery);
  const signed = encodeSigned(items.slice(0, 6), v, signature);
  return { signedTx: `0x${Buffer.from(signed).toString("hex")}` };
};

const encodeSigned = (items: Uint8Array[], v: bigint, signature: { r: bigint; s: bigint }) => {
  const body = [...items, bigIntToBytes(v), bigIntToBytes(signature.r), bigIntToBytes(signature.s)].map(rlpString);
  return concat([rlpLength(0xc0, body.reduce((sum, item) => sum + item.length, 0)), ...body]);
};

const start = () => {
  const host = process.env.SWEEP_SIGNER_HOST ?? "127.0.0.1";
  const port = Number(process.env.SWEEP_SIGNER_PORT ?? 8787);
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Signer binds to localhost only");
  const xprv = process.env.EVM_ACCOUNT_XPRV ?? "";
  if (!xprv) throw new Error("Set EVM_ACCOUNT_XPRV in this process only");
  const account = parseAccountXprv(xprv);
  const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/sign") {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = JSON.parse(await readBody(req)) as { unsignedTx: string; fromAddress: string; derivationIndex: number; chainId: number };
    const signed = signSweep(account, body);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(signed));
  } catch (error) {
    res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "rejected" }));
  }
  });
  server.listen(port, host, () => {
    console.log(`evm signer listening on http://${host}:${port}`);
  });
};

const invokedDirectly = process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
if (invokedDirectly) start();
