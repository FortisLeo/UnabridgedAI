import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { addressOf, deriveDepositKey, parseAccountXprv, signSweep } from "./evm-signer.ts";
import { unsignedTokenTransfer } from "../src/payments/evm-sweep.ts";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58 = (bytes: Buffer) => {
  let num = BigInt(`0x${bytes.toString("hex")}`);
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

const accountKey = secp256k1.utils.randomPrivateKey();
const payload = Buffer.alloc(78);
payload.writeUInt32BE(0x0488ade4, 0);
payload[4] = 3;
payload.writeUInt32BE(0x80000000, 9);
payload.set(randomBytes(32), 13);
payload.set(accountKey, 46);
const checksum = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
const account = parseAccountXprv(base58(Buffer.concat([payload, checksum])));
const index = 4;
const from = addressOf(deriveDepositKey(account, index));
const cold = "0x2222222222222222222222222222222222222222";
const unsigned = unsignedTokenTransfer({
  nonce: 3n,
  gasPrice: 100n,
  gasLimit: 80_000n,
  token: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  to: cold,
  amount: 10_000n,
  chainId: 137n,
});

const signed = signSweep(account, { unsignedTx: unsigned, fromAddress: from, derivationIndex: index, chainId: 137, coldAddress: cold });
const raw = Buffer.from(signed.signedTx.slice(2), "hex");
const s = raw.subarray(raw.length - 32);
const r = raw.subarray(raw.length - 65, raw.length - 33);
const recovery = Number(raw.subarray(raw.length - 68, raw.length - 66).readUInt16BE(0) - (137 * 2 + 35));
const hash = keccak_256(Buffer.from(unsigned.slice(2), "hex"));
const recovered = secp256k1.Signature.fromCompact(Buffer.concat([r, s])).addRecoveryBit(recovery).recoverPublicKey(hash).toRawBytes(false).subarray(1);
assert.equal(`0x${Buffer.from(keccak_256(recovered).subarray(12)).toString("hex")}`, from);
assert.throws(() => signSweep(account, { unsignedTx: unsigned, fromAddress: cold, derivationIndex: index, chainId: 137, coldAddress: cold }));
const attacker = unsignedTokenTransfer({ nonce: 3n, gasPrice: 100n, gasLimit: 80_000n, token: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", to: "0x3333333333333333333333333333333333333333", amount: 10_000n, chainId: 137n });
assert.throws(() => signSweep(account, { unsignedTx: attacker, fromAddress: from, derivationIndex: index, chainId: 137, coldAddress: cold }));

console.log("evm signer test passed");
