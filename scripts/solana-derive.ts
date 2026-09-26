import { derivePath } from "ed25519-hd-key";
import { getPublicKeyAsync } from "@noble/ed25519";

const seed = process.env.SOLANA_SEED?.trim() ?? "";
const count = Number(process.env.SOLANA_DERIVE_COUNT ?? 1000);
if (!seed || !Number.isInteger(count) || count < 1) {
  console.error("SOLANA_SEED and a positive SOLANA_DERIVE_COUNT are required");
  process.exit(1);
}

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

for (let index = 0; index < count; index += 1) {
  const { key } = derivePath(`m/44'/501'/${index}'/0'`, seed);
  const pubkey = encodeBase58(await getPublicKeyAsync(key));
  process.stdout.write(`${pubkey}${index + 1 === count ? "\n" : ","}`);
}
