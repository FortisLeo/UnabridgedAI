import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { derivePath } from "ed25519-hd-key";
import { getPublicKeyAsync } from "@noble/ed25519";

const seed = process.env.SOLANA_SEED?.trim() ?? "";
const token = process.env.SOLANA_HELPER_TOKEN?.trim() ?? "";
const port = Number(process.env.SOLANA_HELPER_PORT ?? 18099);
if (!seed || !token) {
  console.error("SOLANA_SEED and SOLANA_HELPER_TOKEN are required");
  process.exit(1);
}

const authorized = (header: string | undefined) => {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const encodeBase58 = (bytes: Uint8Array) => {
  let num = 0n;
  for (const byte of bytes) num = (num << 8n) + BigInt(byte);
  let out = "";
  while (num > 0n) {
    out = alphabet[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
};

const pubkeyAt = async (index: number) => {
  const { key } = derivePath(`m/44'/501'/${index}'/0'`, seed);
  return encodeBase58(await getPublicKeyAsync(key));
};

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/derive") {
    res.writeHead(404).end();
    return;
  }
  if (!authorized(req.headers.authorization)) {
    res.writeHead(401).end();
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    void (async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { index?: number };
        if (!Number.isInteger(body.index) || (body.index ?? -1) < 0) throw new Error("bad index");
        const pubkey = await pubkeyAt(body.index as number);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ index: body.index, pubkey }));
      } catch {
        res.writeHead(400).end();
      }
    })();
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`solana derive helper on 127.0.0.1:${port}`);
});
