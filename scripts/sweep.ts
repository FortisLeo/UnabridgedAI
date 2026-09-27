import { closeDb } from "../src/db/client.ts";
import { runSweep } from "../src/payments/evm-sweep.ts";

const chain = process.argv[2];
if (chain !== "polygon" && chain !== "ethereum") {
  console.error("usage: tsx scripts/sweep.ts <polygon|ethereum>");
  console.error("The web app never sees the spending key. Start scripts/evm-signer.ts on localhost with EVM_ACCOUNT_XPRV first.");
  process.exit(1);
}

try {
  const sent = await runSweep(chain);
  if (sent.length === 0) console.log(`no ${chain} invoice is ready to sweep`);
  for (const item of sent) console.log(`${item.invoiceId} ${item.txHash}`);
} finally {
  closeDb();
}
