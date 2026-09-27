import { env } from "../lib/env.ts";
import { scrub } from "../lib/errors.ts";
import { chainIdOf, entryByContract, EVM_REORG_WINDOW, MONERO_CONFIRMATIONS, MONERO_HEIGHT_LAG_BLOCKS, SOLANA_REORG_SLOTS, TRANSFER_TOPIC } from "./allowlist.ts";
import { formatBaseUnits } from "./amounts.ts";
import { balanceOf, blockHeader, createJsonRpc, evmChainId, finalizedHead, getReceipt, getTransferLogs, isRangeError, solanaSignatures, solanaSlot, solanaTokenDeltas, usdtFee, type JsonRpc, type TransferLog } from "./chain.ts";
import { padTopicAddress } from "./evm-address.ts";
import { applySettlement } from "./settle.ts";
import { ataOf, creditsFor, cursorOf, evmAddresses, invoiceByAddress, markMissing, saveCursor, upsertCredit, watchedInvoices, type InvoiceRow } from "./store.ts";
import { incomingTransfers, refreshWallet, unlockTimeOf, walletHeight, walletRpc } from "./wallet-rpc.ts";

type Backoff = { delay: number; nextAt: number };
const backoff = new Map<string, Backoff>();
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let grantInFlight = false;

const watcherCause = (error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown watcher error";
  return scrub(message).replace(/https?:\/\/\S+/gi, "[redacted]").slice(0, 180);
};

const noteFailure = (chain: string, error: unknown) => {
  const current = backoff.get(chain) ?? { delay: 15_000, nextAt: 0 };
  const delay = Math.min(current.delay * 2, 30_000);
  backoff.set(chain, { delay, nextAt: Date.now() + delay });
  console.error(scrub(`payment watcher ${chain} failed: ${watcherCause(error)}`));
};

const ready = (chain: string) => (backoff.get(chain)?.nextAt ?? 0) <= Date.now();
const noteSuccess = (chain: string) => backoff.set(chain, { delay: 15_000, nextAt: 0 });

export const startPaymentWatchers = () => {
  if (timer || env.paymentWatchMs <= 0) return;
  timer = setInterval(() => {
    void tick();
  }, env.paymentWatchMs);
  timer.unref?.();
  void tick();
};

export const stopPaymentWatchers = async () => {
  if (timer) clearInterval(timer);
  timer = null;
  const started = Date.now();
  while (grantInFlight && Date.now() - started < 5_000) await new Promise((resolve) => setTimeout(resolve, 50));
};

const tick = async () => {
  if (running) return;
  running = true;
  try {
    if (ready("ethereum")) await watchEvm("ethereum").then(() => noteSuccess("ethereum")).catch((error) => noteFailure("ethereum", error));
    if (ready("polygon")) await watchEvm("polygon").then(() => noteSuccess("polygon")).catch((error) => noteFailure("polygon", error));
    if (ready("solana")) await watchSolana().then(() => noteSuccess("solana")).catch((error) => noteFailure("solana", error));
    if (ready("monero")) await watchMonero().then(() => noteSuccess("monero")).catch((error) => noteFailure("monero", error));
  } finally {
    running = false;
  }
};

const providers = (urls: string[]) => urls.map(createJsonRpc);

const agreed = async <T>(calls: Array<Promise<T>>, same: (left: T, right: T) => boolean) => {
  const results = await Promise.allSettled(calls);
  const values = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (values.length === 0) throw new Error("no provider");
  if (values.length === 1) return { value: values[0] as T, sources: 1 as const };
  if (!same(values[0] as T, values[1] as T)) throw new Error("providers disagree");
  return { value: values[0] as T, sources: 2 as const };
};

const EVM_LOG_BATCH = { ethereum: 2_000, polygon: 10 } as const;

const firstRpc = async <T>(rpcs: JsonRpc[], read: (rpc: JsonRpc) => Promise<T>) => {
  let last: unknown = new Error("no provider");
  for (const rpc of rpcs) {
    try {
      return await read(rpc);
    } catch (error) {
      last = error;
    }
  }
  throw last;
};

const logsWithFallback = async (rpcs: JsonRpc[], from: number, to: number, contract: string, topics: string[]): Promise<TransferLog[]> => {
  try {
    return await firstRpc(rpcs, (rpc) => getTransferLogs(rpc, from, to, contract, topics));
  } catch (error) {
    if (!isRangeError(error) || to <= from) throw error;
    const mid = from + Math.floor((to - from) / 2);
    return [...(await logsWithFallback(rpcs, from, mid, contract, topics)), ...(await logsWithFallback(rpcs, mid + 1, to, contract, topics))];
  }
};

type EvmHead = { height: number; hash: string; sources: 1 | 2 };

const agreedEvmHead = async (rpcs: JsonRpc[]): Promise<EvmHead> => {
  const settled = await Promise.allSettled(rpcs.map((rpc) => finalizedHead(rpc)));
  const heads = settled.flatMap((result, index) => (result.status === "fulfilled" ? [{ index, ...result.value }] : []));
  if (heads.length === 0) throw settled.find((result) => result.status === "rejected")?.reason ?? new Error("no provider");
  const highest = heads.reduce((best, head) => (head.height > best.height ? head : best));
  const confirmed = (
    await Promise.all(heads.map(async (head) => (head.index === highest.index ? highest : blockHeader(rpcs[head.index] as JsonRpc, highest.height))))
  ).filter((header) => header?.hash === highest.hash && header.height === highest.height);
  if (confirmed.length === 0) throw new Error("providers disagree");
  return { height: highest.height, hash: highest.hash, sources: confirmed.length > 1 ? 2 : 1 };
};

const watchEvm = async (chain: "ethereum" | "polygon") => {
  const urls = chain === "ethereum" ? env.ethereumRpcUrls : env.polygonRpcUrls;
  if (urls.length === 0 || evmAddresses().length === 0) return;
  const configured = providers(urls);
  const identities = await Promise.allSettled(configured.map((rpc) => evmChainId(rpc)));
  const rpcs = configured.filter((_, index) => identities[index]?.status === "fulfilled" && identities[index].value === chainIdOf(chain));
  if (identities.some((result) => result.status === "fulfilled" && result.value !== chainIdOf(chain))) throw new Error("wrong chain id");
  if (rpcs.length === 0) throw identities.find((result) => result.status === "rejected")?.reason ?? new Error("no provider");
  const head = await agreedEvmHead(rpcs);
  const cursor = cursorOf(chain)?.height ?? Math.max(0, head.height - EVM_REORG_WINDOW[chain]);
  const from = Math.max(0, Math.min(cursor, head.height) - EVM_REORG_WINDOW[chain]);
  const to = Math.min(head.height, Math.max(cursor, from) + EVM_LOG_BATCH[chain]);
  if (to < from) return;
  const invoices = watchedInvoices().filter((invoice) => invoice.chain === "ethereum" || invoice.chain === "polygon");
  const topics = invoices.map((invoice) => padTopicAddress(invoice.address));
  if (topics.length === 0) return;
  const contracts = [...new Set(invoices.filter((invoice) => invoice.chain === chain).map((invoice) => invoice.token_contract).filter((item): item is string => Boolean(item)))];
  for (const contract of contracts) {
    for (let start = 0; start < topics.length; start += 20) {
      const chunk = topics.slice(start, start + 20);
      const logs = await logsWithFallback(rpcs, from, to, contract, [TRANSFER_TOPIC, ...chunk]);
      for (const log of logs) {
        if (log.removed || log.value <= 0n) continue;
        const invoice = invoiceByAddress(log.to);
        if (!invoice) continue;
        const asset = entryByContract(chain, log.contract);
        const wrong = !asset || asset.asset !== invoice.asset || invoice.chain !== chain;
        const receipt = await firstRpc(rpcs, (rpc) => getReceipt(rpc, log.txHash));
        if (!receipt?.status) continue;
        const seenFinalized = head.height >= log.blockNumber && receipt.blockHash === log.blockHash;
        let confirmed = head.sources > 1;
        if (seenFinalized && rpcs.length > 1) {
          const other = await firstRpc(rpcs.slice(1), (rpc) => getReceipt(rpc, log.txHash));
          confirmed = Boolean(other?.status && other.blockHash === receipt.blockHash);
        }
        const settled = seenFinalized && confirmed;
        upsertCredit({
          invoice_id: invoice.id,
          chain,
          tx_hash: log.txHash,
          output_index: log.logIndex,
          output_pubkey: null,
          from_address: null,
          base_units: formatBaseUnits(log.value),
          height: log.blockNumber,
          block_hash: log.blockHash,
          confirmations: Math.max(0, head.height - log.blockNumber),
          locked: 0,
          wrong_asset: wrong ? 1 : 0,
          settled: settled && !wrong ? 1 : 0,
          now: Date.now(),
        });
      }
    }
  }
  for (const invoice of invoices.filter((item) => item.chain === chain && item.token_contract)) {
    const onChain = await firstRpc(rpcs, (rpc) => balanceOf(rpc, invoice.token_contract as string, invoice.address));
    const logged = creditsFor(invoice.id)
      .filter((credit) => credit.chain === chain && credit.settled === 1 && credit.wrong_asset === 0 && credit.disappeared_at == null)
      .reduce((sum, credit) => sum + BigInt(credit.base_units), 0n);
    if (onChain !== logged) continue;
    let secondReadAgrees = head.sources > 1;
    if (head.sources > 1) {
      const otherBalance = await balanceOf(rpcs[1] as JsonRpc, invoice.token_contract as string, invoice.address);
      secondReadAgrees = otherBalance === onChain;
    }
    const fee = chain === "ethereum" && invoice.asset === "usdt" ? await usdtFee(rpcs[0] as JsonRpc, invoice.token_contract as string) : undefined;
    grantInFlight = true;
    try {
      applySettlement(invoice, creditsFor(invoice.id), Date.now(), secondReadAgrees, fee);
    } finally {
      grantInFlight = false;
    }
  }
  saveCursor(chain, to, to === head.height ? head.hash : null, Date.now());
};

const watchSolana = async () => {
  if (env.solanaRpcUrls.length === 0) return;
  const rpcs = providers(env.solanaRpcUrls);
  const slot = await agreed(
    rpcs.map((rpc) => solanaSlot(rpc, "finalized")),
    (left, right) => left === right,
  );
  const invoices = watchedInvoices().filter((invoice) => invoice.chain === "solana");
  for (const invoice of invoices) {
    const ata = ataOf(invoice.address);
    if (!ata) continue;
    const signatures = await solanaSignatures(rpcs[0] as JsonRpc, ata);
    const seen = new Set<string>();
    for (const item of signatures) {
      if (slot.value - item.slot < 0) continue;
      const deltas = await solanaTokenDeltas(rpcs[0] as JsonRpc, item.signature);
      for (const delta of deltas) {
        if (delta.delta <= 0n || delta.account !== ata) continue;
        const wrong = delta.mint !== invoice.token_contract;
        const key = `${item.signature}:${delta.accountIndex}:${delta.account}`;
        seen.add(key);
        upsertCredit({
          invoice_id: invoice.id,
          chain: "solana",
          tx_hash: item.signature,
          output_index: delta.accountIndex,
          output_pubkey: delta.account,
          from_address: null,
          base_units: formatBaseUnits(delta.delta),
          height: delta.slot,
          block_hash: null,
          confirmations: Math.max(0, slot.value - delta.slot),
          locked: 0,
          wrong_asset: wrong ? 1 : 0,
          settled: slot.value - delta.slot >= SOLANA_REORG_SLOTS && !wrong ? 1 : 0,
          now: Date.now(),
        });
      }
    }
    markMissing(invoice.id, "solana", seen, Date.now());
    grantInFlight = true;
    try {
      applySettlement(invoice, creditsFor(invoice.id), Date.now(), true);
    } finally {
      grantInFlight = false;
    }
  }
  saveCursor("solana", slot.value, null, Date.now());
};

const locked = (unlockTime: number | null, height: number, now: number) => {
  if (unlockTime == null || unlockTime === 0) return false;
  if (unlockTime >= 500_000_000) return now / 1000 < unlockTime;
  return height < unlockTime;
};

const watchMonero = async () => {
  if (!env.moneroWalletRpcUrl) return;
  await refreshWallet();
  const height = await walletHeight();
  const daemon = await walletRpc<{ height?: number }>("get_height");
  if (typeof daemon.height === "number" && daemon.height - height > MONERO_HEIGHT_LAG_BLOCKS) return;
  const invoices = watchedInvoices().filter((invoice) => invoice.chain === "monero");
  for (const invoice of invoices) await watchMoneroInvoice(invoice, height);
  saveCursor("monero", height, null, Date.now());
};

const watchMoneroInvoice = async (invoice: InvoiceRow, height: number) => {
  const transfers = await incomingTransfers(invoice.derivation_index);
  const seen = new Set<string>();
  const observed = new Set<string>();
  const now = Date.now();
  let complete = true;
  for (const transfer of transfers) {
    if (transfer.minor !== invoice.derivation_index || transfer.major !== 0 || transfer.amount <= 0n) continue;
    const outputIndex = transfer.globalIndex ?? 0;
    const pubkey = transfer.globalIndex == null ? transfer.pubkey : null;
    const identity = `${transfer.txHash}:${outputIndex}:${pubkey ?? ""}`;
    seen.add(identity);
    observed.add(`${identity}:${transfer.amount.toString()}`);
    let unlock: number | null = null;
    try {
      unlock = await unlockTimeOf(transfer.txHash);
    } catch {
      complete = false;
      continue;
    }
    const isLocked = transfer.frozen || locked(unlock, height, now);
    const confirmations = transfer.blockHeight > 0 ? Math.max(0, height - transfer.blockHeight) : 0;
    upsertCredit({
      invoice_id: invoice.id,
      chain: "monero",
      tx_hash: transfer.txHash,
      output_index: outputIndex,
      output_pubkey: pubkey,
      from_address: null,
      base_units: formatBaseUnits(transfer.amount),
      height: transfer.blockHeight,
      block_hash: null,
      confirmations,
      locked: isLocked ? 1 : 0,
      wrong_asset: isLocked ? 1 : 0,
      settled: confirmations >= MONERO_CONFIRMATIONS && !isLocked ? 1 : 0,
      now,
    });
  }
  if (complete) markMissing(invoice.id, "monero", seen, now);
  const again = await incomingTransfers(invoice.derivation_index);
  const againObserved = new Set(
    again
      .filter((transfer) => transfer.minor === invoice.derivation_index && transfer.major === 0 && transfer.amount > 0n)
      .map((transfer) => {
        const outputIndex = transfer.globalIndex ?? 0;
        const pubkey = transfer.globalIndex == null ? transfer.pubkey : null;
        return `${transfer.txHash}:${outputIndex}:${pubkey ?? ""}:${transfer.amount.toString()}`;
      }),
  );
  const agrees = complete && observed.size === againObserved.size && [...observed].every((key) => againObserved.has(key));
  grantInFlight = true;
  try {
    applySettlement(invoice, creditsFor(invoice.id), Date.now(), agrees);
  } finally {
    grantInFlight = false;
  }
};

export const watchOnceForTests = tick;
