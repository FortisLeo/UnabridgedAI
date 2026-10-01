import { db } from "../db/client.ts";
import { env } from "../lib/env.ts";
import { randomUUID } from "../lib/crypto.ts";
import { quotaFor, getUserUsage } from "../repositories/usage.ts";
import { QR_TTL_MS, type AllowlistEntry } from "./allowlist.ts";
import { displayAmount, formatBaseUnits, moneroQuote, parseBaseUnits, stablecoinQuote } from "./amounts.ts";
import { deriveEvmAddress } from "./evm-address.ts";
import { associatedTokenAddress, isSolanaAddress } from "./solana-ata.ts";
import { deriveSolanaOwner, solanaConfigured } from "./solana-helper.ts";
import { addressIndex, createSubaddress, isMainnetSubaddress, makeUri, moneroConfigured, setLookahead } from "./wallet-rpc.ts";
import { sums } from "./settle.ts";
import {
  blockingInvoice,
  creditsFor,
  getInvoice,
  invoicesForUser,
  insertAddress,
  insertInvoice,
  insertSkipped,
  priceOf,
  setRefundAddress,
  takeIndex,
  userCreateLimited,
  type CreditRow,
  type InvoiceRow,
} from "./store.ts";

export class InvoiceError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const familyOf = (chain: AllowlistEntry["chain"]) => (chain === "solana" ? "solana" : chain === "monero" ? "monero" : "evm");

export const createInvoice = async (userId: string, pair: AllowlistEntry, now = Date.now()) => {
  if (userCreateLimited(userId, now)) throw new InvoiceError(429, "Too many invoices for this account. Try later.");
  const blocking = blockingInvoice(userId);
  if (blocking) throw new InvoiceError(409, "Finish or wait out the current invoice.", { invoiceId: blocking.id });
  const expected = quoteFor(pair);
  const id = randomUUID();
  const family = familyOf(pair.chain);
  if (family === "evm" && !env.evmAccountXpub) throw new InvoiceError(503, "Payments are not available.");
  if (family === "solana" && !solanaConfigured()) throw new InvoiceError(503, "Payments are not available.");
  if (family === "monero" && !moneroConfigured()) throw new InvoiceError(503, "Payments are not available.");

  const reserved = db.transaction(() => takeIndex(family))();
  try {
    const allocated = await allocate(family, reserved, pair, id);
    db.transaction(() => {
      insertAddress(allocated.address, family, reserved, allocated.ata, now);
      insertInvoice({
        id,
        userId,
        chain: pair.chain,
        asset: pair.asset,
        tokenContract: pair.contract,
        expected: formatBaseUnits(expected),
        address: allocated.address,
        index: reserved,
        now,
        expiresAt: now + QR_TTL_MS,
        uri: allocated.uri,
      });
    })();
  } catch (error) {
    db.transaction(() => insertSkipped(family, reserved, now))();
    if (error instanceof InvoiceError) throw error;
    throw new InvoiceError(503, "Payments are not available.");
  }
  const invoice = getInvoice(id);
  if (!invoice) throw new InvoiceError(503, "Payments are not available.");
  return present(invoice, []);
};

const quoteFor = (pair: AllowlistEntry) => {
  if (pair.chain === "monero") {
    const raw = priceOf("xmr_atomic_units");
    if (!raw) throw new InvoiceError(503, "Payments are not available.");
    return moneroQuote(parseBaseUnits(raw));
  }
  const raw = priceOf("pro_price_cents");
  if (!raw) throw new InvoiceError(503, "Payments are not available.");
  return stablecoinQuote(parseBaseUnits(raw));
};

const allocate = async (family: "evm" | "solana" | "monero", index: number, pair: AllowlistEntry, invoiceId: string) => {
  if (family === "evm") return { address: deriveEvmAddress(env.evmAccountXpub, index), ata: null, uri: null };
  if (family === "solana") {
    const owner = await deriveSolanaOwner(index);
    if (!pair.contract) throw new InvoiceError(503, "Payments are not available.");
    return { address: owner, ata: associatedTokenAddress(owner, pair.contract), uri: null };
  }
  await setLookahead(Math.max(200, index + 50));
  const created = await createSubaddress(invoiceId);
  if (created.index !== index || !isMainnetSubaddress(created.address)) throw new InvoiceError(503, "Payments are not available.");
  const roundTrip = await addressIndex(created.address);
  if (roundTrip.major !== 0 || roundTrip.minor !== index) throw new InvoiceError(503, "Payments are not available.");
  return { address: created.address, ata: null, uri: await makeUri(created.address, formatBaseUnits(quoteFor(pair))) };
};

export const readInvoice = (userId: string, id: string) => {
  const invoice = getInvoice(id);
  if (!invoice || invoice.user_id !== userId) return null;
  return present(invoice, creditsFor(id));
};

export const resumeInvoice = (userId: string) => {
  const blocking = blockingInvoice(userId);
  if (!blocking) return null;
  return readInvoice(userId, blocking.id);
};

export const paymentHistory = (userId: string) =>
  invoicesForUser(userId).map((invoice) => {
    const decimals = invoice.chain === "monero" ? 12 : 6;
    return {
      id: invoice.id,
      chain: invoice.chain,
      asset: invoice.asset,
      displayAmount: displayAmount(parseBaseUnits(invoice.expected_base_units), decimals),
      status: invoice.status,
      createdAt: invoice.created_at,
    };
  });

export const submitRefundAddress = (userId: string, id: string, address: string, chain: string, now = Date.now()) => {
  const invoice = getInvoice(id);
  if (!invoice || invoice.user_id !== userId) return null;
  const allowed = invoice.status === "overpaid" || invoice.status === "wrong_asset" || (invoice.status === "succeeded" && invoice.already_pro === 1);
  if (!allowed) throw new InvoiceError(409, "This invoice does not need a refund address.");
  if (!validRefundAddress(chain, address)) throw new InvoiceError(400, "Refund address is not valid for that chain.");
  setRefundAddress(id, address.trim(), chain, now);
  return present(getInvoice(id)!, creditsFor(id));
};

const validRefundAddress = (chain: string, address: string) => {
  if (chain === "ethereum" || chain === "polygon") return /^0x[0-9a-fA-F]{40}$/.test(address);
  if (chain === "solana") return isSolanaAddress(address);
  if (chain === "monero") return /^[48][1-9A-HJ-NP-Za-km-z]{94,}$/.test(address);
  return false;
};

export const present = (invoice: InvoiceRow, credits: CreditRow[]) => {
  const decimals = invoice.chain === "monero" ? 12 : 6;
  const { received, remaining } = sums(invoice, credits);
  const user = getUserUsage(invoice.user_id);
  return {
    id: invoice.id,
    chain: invoice.chain,
    asset: invoice.asset,
    tokenContract: invoice.token_contract,
    address: invoice.address,
    expectedBaseUnits: invoice.expected_base_units,
    displayAmount: displayAmount(parseBaseUnits(invoice.expected_base_units), decimals),
    uri: invoice.uri,
    status: invoice.status,
    qrExpiresAt: invoice.qr_expires_at,
    createdAt: invoice.created_at,
    receivedBaseUnits: received.toString(),
    remainingBaseUnits: remaining.toString(),
    confirmationsRequired: invoice.chain === "monero" ? 10 : null,
    confirmationsSeen: credits.reduce((max, credit) => Math.max(max, credit.confirmations), 0),
    alreadyPro: invoice.already_pro === 1,
    credits: credits.map((credit) => ({
      txHash: credit.tx_hash,
      baseUnits: credit.base_units,
      confirmations: credit.confirmations,
      settled: credit.settled === 1,
      locked: credit.locked === 1,
      wrongAsset: credit.wrong_asset === 1,
    })),
    quota: user ? quotaFor(user) : null,
  };
};
